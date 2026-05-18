import type { AppBuilderClient } from "../appBuilder/appBuilderClient";
import { normalizePlatformDeploymentTarget, type AppSpec, type AppSpecField } from "../domain/appSpec";
import { classifyConfirmationDeterministically } from "../domain/confirmation";
import {
  appendMessage,
  type ChatMessage,
  createConversationState,
  type ConversationState,
  type ConversationStatus
} from "../domain/conversationState";
import {
  compactConversationForContext,
  defaultContextWindowOptions,
  getContextWindowUsage,
  type ContextWindowOptions,
  type ContextWindowUsage
} from "../domain/contextWindow";
import { mergeAppSpec } from "../domain/mergeAppSpec";
import { createUserPreferences, mergeUserPreferencesFromAppSpec, type UserPreferences } from "../domain/userPreferences";
import { getMissingFields, getRequiredFieldsForSpec } from "../domain/validation";
import type { LlmClient } from "../llm/llmClient";
import { getErrorAttributes, noopTelemetry, type Telemetry } from "../observability/telemetry";
import type { AppCommandRepository } from "../persistence/appCommandRepository";
import type { ConversationRepository } from "../persistence/conversationRepository";
import type { UserPreferencesRepository } from "../persistence/userPreferencesRepository";
import { createPlannedAppCommandRecord, planCreateAppCommand, type AppCommandRecord } from "./appCommand";
import { executeCreateAppCommand, type AppBuilderRetryOptions } from "./appCommandExecutor";

export interface HandleChatTurnInput {
  conversationId: string;
  userId?: string | null;
  message: string;
  repository: ConversationRepository;
  userPreferencesRepository?: UserPreferencesRepository;
  commandRepository?: AppCommandRepository;
  llmClient: LlmClient;
  appBuilder: AppBuilderClient;
  contextWindow?: ContextWindowOptions;
  appBuilderRetry?: AppBuilderRetryOptions;
  telemetry?: Telemetry;
}

export interface ChatTurnResponse {
  conversationId: string;
  status: ConversationStatus;
  message: string;
  messages: ChatMessage[];
  appSpec: AppSpec;
  missingFields: string[];
  requiredFields: AppSpecField[];
  contextWindow: ContextWindowUsage;
  createdApp?: {
    appId: string;
    url: string;
  };
  userPreferences?: UserPreferences;
  commands?: AppCommandRecord[];
}

export async function handleChatTurn(input: HandleChatTurnInput): Promise<ChatTurnResponse> {
  const telemetry = input.telemetry ?? noopTelemetry;
  const startedAt = Date.now();

  try {
    return await handleChatTurnInternal(input, telemetry, startedAt);
  } catch (error) {
    telemetry.event("chat_turn_failed", {
      conversationId: input.conversationId,
      userId: input.userId ?? null,
      ...getErrorAttributes(error)
    });
    telemetry.metric("chat_turn_failure_count", 1, {
      conversationId: input.conversationId
    });
    throw error;
  }
}

async function handleChatTurnInternal(
  input: HandleChatTurnInput,
  telemetry: Telemetry,
  startedAt: number
): Promise<ChatTurnResponse> {
  const existingState = await input.repository.get(input.conversationId);
  const state = existingState ?? createConversationState(input.conversationId, input.userId);
  const contextWindow = input.contextWindow ?? defaultContextWindowOptions;
  state.userId = input.userId ?? state.userId ?? null;
  telemetry.event("chat_turn_started", {
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    status: state.status,
    newConversation: existingState === undefined
  });
  if (existingState === undefined) {
    telemetry.metric("conversation_started_count", 1, {
      conversationId: state.conversationId
    });
  }
  appendMessage(state, "user", input.message);
  compactConversationForContext(state, contextWindow);

  if (state.status === "awaiting_confirmation") {
    return handleConfirmationTurn(state, input, contextWindow, telemetry, startedAt);
  }

  if (state.status === "created") {
    return saveAndRespond(input, state, getCreatedConversationResponse(input.message, state), contextWindow, telemetry, startedAt);
  }

  return handleRequirementCollectionTurn(state, input, contextWindow, telemetry, startedAt);
}

async function handleRequirementCollectionTurn(
  state: ConversationState,
  input: HandleChatTurnInput,
  contextWindow: ContextWindowOptions,
  telemetry: Telemetry,
  startedAt: number
): Promise<ChatTurnResponse> {
  if (getContextWindowUsage(state, contextWindow).status === "blocked") {
    telemetry.event("context_window_blocked", {
      conversationId: state.conversationId,
      userId: state.userId ?? null
    });
    return saveAndRespond(input, state, getContextLimitMessage(), contextWindow, telemetry, startedAt);
  }

  const extracted = await extractRequirements(state, input, telemetry);

  const casualResponse = countExtractedFields(extracted) === 0 ? getCasualResponse(input.message) : undefined;
  if (casualResponse) {
    state.readyToBuild = false;
    state.confirmed = false;
    state.status = "collecting_requirements";
    state.missingFields = getMissingFields(state.appSpec);
    return saveAndRespond(input, state, casualResponse, contextWindow, telemetry, startedAt);
  }

  return applyRequirementsAndRespond(state, input, contextWindow, telemetry, startedAt, extracted);
}

async function applyRequirementsAndRespond(
  state: ConversationState,
  input: HandleChatTurnInput,
  contextWindow: ContextWindowOptions,
  telemetry: Telemetry,
  startedAt: number,
  extracted: Partial<AppSpec>
): Promise<ChatTurnResponse> {
  state.appSpec = mergeAppSpec(state.appSpec, extracted);
  state.missingFields = getMissingFields(state.appSpec);
  telemetry.event("missing_fields_evaluated", {
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    missingFields: state.missingFields,
    missingFieldCount: state.missingFields.length
  });

  if (state.missingFields.length > 0) {
    state.readyToBuild = false;
    state.confirmed = false;
    state.status = "collecting_requirements";

    const response = await input.llmClient.generateClarifyingQuestion({
      appSpec: state.appSpec,
      missingFields: state.missingFields
    });

    telemetry.metric("clarification_question_count", 1, {
      conversationId: state.conversationId
    });

    return saveAndRespond(input, state, response, contextWindow, telemetry, startedAt);
  }

  state.readyToBuild = true;
  state.confirmed = false;
  state.status = "awaiting_confirmation";

  const response = await input.llmClient.generateConfirmationSummary({ appSpec: state.appSpec });
  telemetry.event("confirmation_requested", {
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    appType: state.appSpec.appType ?? null
  });
  return saveAndRespond(input, state, response, contextWindow, telemetry, startedAt);
}

async function handleConfirmationTurn(
  state: ConversationState,
  input: HandleChatTurnInput,
  contextWindow: ContextWindowOptions,
  telemetry: Telemetry,
  startedAt: number
): Promise<ChatTurnResponse> {
  const deterministicDecision = classifyConfirmationDeterministically(input.message);
  const decision = deterministicDecision;

  if (deterministicDecision === "ambiguous") {
    const requirementChangeResponse = await tryHandleConfirmationRequirementChange(
      state,
      input,
      contextWindow,
      telemetry,
      startedAt
    );
    if (requirementChangeResponse) {
      return requirementChangeResponse;
    }
  }

  telemetry.event("confirmation_received", {
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    decision
  });
  telemetry.metric("confirmation_decision_count", 1, {
    conversationId: state.conversationId,
    decision
  });

  if (decision === "no") {
    state.confirmed = false;
    state.readyToBuild = false;
    state.status = "collecting_requirements";
    return saveAndRespond(input, state, "No problem. What would you like to change?", contextWindow, telemetry, startedAt);
  }

  if (decision === "ambiguous") {
    return saveAndRespond(input, state, "Please reply yes to create the app, or no if you want to change the requirements.", contextWindow, telemetry, startedAt);
  }

  state.confirmed = true;
  state.readyToBuild = true;
  state.status = "creating_app";
  state.missingFields = getMissingFields(state.appSpec);

  if (state.missingFields.length > 0) {
    state.confirmed = false;
    state.readyToBuild = false;
    state.status = "collecting_requirements";
    const response = await input.llmClient.generateClarifyingQuestion({
      appSpec: state.appSpec,
      missingFields: state.missingFields
    });
    return saveAndRespond(input, state, response, contextWindow, telemetry, startedAt);
  }

  const command = planCreateAppCommand(state);
  await input.commandRepository?.save(createPlannedAppCommandRecord(command));
  telemetry.event("app_command_planned", {
    commandId: command.id,
    commandType: command.type,
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    riskLevel: command.riskLevel,
    approvalRequired: command.approvalRequired,
    approvalSource: command.approval?.source,
    appType: state.appSpec.appType ?? null
  });

  try {
    const execution = await executeCreateAppCommand({
      command,
      appBuilder: input.appBuilder,
      commandRepository: input.commandRepository,
      retry: input.appBuilderRetry,
      telemetry
    });
    const result = execution.result;
    state.status = "created";
    state.createdAppId = result.appId;
    state.createdAppUrl = result.url;
    return saveAndRespond(input, state, `Created the app. You can open it at ${result.url}.`, contextWindow, telemetry, startedAt, {
      appId: result.appId,
      url: result.url
    });
  } catch (error) {
    state.status = "failed";
    telemetry.event("app_command_failed_to_complete", {
      commandId: command.id,
      commandType: command.type,
      conversationId: state.conversationId,
      userId: state.userId ?? null,
      ...getErrorAttributes(error)
    });
    return saveAndRespond(input, state, "I could not create the app because the app builder failed. Your requirements are saved, so you can try again in a moment.", contextWindow, telemetry, startedAt);
  }
}

async function tryHandleConfirmationRequirementChange(
  state: ConversationState,
  input: HandleChatTurnInput,
  contextWindow: ContextWindowOptions,
  telemetry: Telemetry,
  startedAt: number
): Promise<ChatTurnResponse | undefined> {
  if (getContextWindowUsage(state, contextWindow).status === "blocked") {
    return undefined;
  }

  const extracted = await extractRequirements(state, input, telemetry);
  if (countExtractedFields(extracted) === 0) {
    return undefined;
  }

  state.confirmed = false;
  state.readyToBuild = false;
  telemetry.event("confirmation_requirement_change_detected", {
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    extractedFieldCount: countExtractedFields(extracted)
  });

  return applyRequirementsAndRespond(state, input, contextWindow, telemetry, startedAt, extracted);
}

async function extractRequirements(
  state: ConversationState,
  input: HandleChatTurnInput,
  telemetry: Telemetry
): Promise<Partial<AppSpec>> {
  telemetry.event("requirement_extraction_started", {
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    missingFields: state.missingFields
  });

  let extracted: Partial<AppSpec>;
  try {
    extracted = await input.llmClient.extractAppSpec({
      userMessage: input.message,
      currentSpec: state.appSpec,
      missingFields: state.missingFields
    });
  } catch (error) {
    telemetry.event("requirement_extraction_failed", {
      conversationId: state.conversationId,
      userId: state.userId ?? null,
      ...getErrorAttributes(error)
    });
    telemetry.metric("llm_request_failure_count", 1, {
      conversationId: state.conversationId,
      task: "extract_app_spec"
    });
    throw error;
  }

  extracted = addDeterministicExtraction(input.message, extracted);

  telemetry.event("requirement_extraction_completed", {
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    extractedFieldCount: countExtractedFields(extracted)
  });

  return extracted;
}

async function saveAndRespond(
  input: HandleChatTurnInput,
  state: ConversationState,
  message: string,
  contextWindow: ContextWindowOptions,
  telemetry: Telemetry,
  startedAt: number,
  createdApp?: ChatTurnResponse["createdApp"]
): Promise<ChatTurnResponse> {
  appendMessage(state, "assistant", message);
  compactConversationForContext(state, contextWindow);
  const userPreferences = await saveUserPreferences(input.userPreferencesRepository, state);
  await input.repository.save(state);
  const latencyMs = Date.now() - startedAt;
  telemetry.event("chat_turn_completed", {
    conversationId: state.conversationId,
    userId: state.userId ?? null,
    status: state.status,
    latencyMs
  });
  telemetry.metric("chat_turn_latency_ms", latencyMs, {
    conversationId: state.conversationId,
    status: state.status
  });

  const commands = await input.commandRepository?.listByConversationId(state.conversationId);

  return {
    conversationId: state.conversationId,
    status: state.status,
    message,
    messages: state.messages,
    appSpec: state.appSpec,
    missingFields: state.missingFields,
    requiredFields: getRequiredFieldsForSpec(state.appSpec),
    contextWindow: getContextWindowUsage(state, contextWindow),
    createdApp,
    userPreferences,
    commands
  };
}

async function saveUserPreferences(
  repository: UserPreferencesRepository | undefined,
  state: ConversationState
): Promise<UserPreferences | undefined> {
  if (!repository || !state.userId) {
    return undefined;
  }

  const existingPreferences = await repository.get(state.userId) ?? createUserPreferences(state.userId);
  const nextPreferences = mergeUserPreferencesFromAppSpec(existingPreferences, state.appSpec);
  await repository.save(nextPreferences);
  return nextPreferences;
}

function getContextLimitMessage(): string {
  return "This conversation has reached the configured context limit, so I paused new requirement extraction to avoid dropping context. Your current spec is saved; start a new conversation or increase the context window setting before continuing.";
}

function addDeterministicExtraction(message: string, extracted: Partial<AppSpec>): Partial<AppSpec> {
  const deploymentTarget = normalizePlatformDeploymentTarget(message);
  const authRequired = getDeterministicAuthRequirement(message);
  const authIntegrations = getDeterministicAuthIntegrations(message);
  const next = { ...extracted };

  if (deploymentTarget && !hasValue(next.deploymentTarget)) {
    next.deploymentTarget = deploymentTarget;
  }

  if (authRequired !== undefined && !hasValue(next.authRequired)) {
    next.authRequired = authRequired;
  }

  if (authIntegrations.length > 0) {
    next.integrations = [...(next.integrations ?? []), ...authIntegrations];
  }

  return next;
}

function getDeterministicAuthRequirement(message: string): boolean | undefined {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const authPattern = /\b(auth|authentication|login|log in|sign in|signin|sign-in|single sign-on|sso|user accounts?)\b/;
  if (!authPattern.test(normalized)) {
    return undefined;
  }

  const disabledPattern = /\b(no|without|skip|disable|exclude)\b.{0,40}\b(auth|authentication|login|log in|sign in|signin|sign-in|single sign-on|sso|user accounts?)\b|\b(do not|don't|dont|doesn't|does not|won't|will not|no need to|no need for)\b.{0,40}\b(auth|authentication|login|log in|sign in|signin|sign-in|single sign-on|sso|user accounts?)\b/;
  if (disabledPattern.test(normalized)) {
    return false;
  }

  return true;
}

function getDeterministicAuthIntegrations(message: string): string[] {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const authProviderPattern = /\b(auth|authentication|login|log in|sign in|signin|sign-in|single sign-on|sso|oauth|openid connect|oidc)\b/;
  if (!authProviderPattern.test(normalized)) {
    return [];
  }

  const integrations: string[] = [];
  if (/\bgoogle\b/.test(normalized)) {
    integrations.push("Google auth");
  }
  if (/\b(microsoft|azure ad|entra|active directory)\b/.test(normalized)) {
    integrations.push("Microsoft auth");
  }
  if (/\b(github|git hub)\b/.test(normalized)) {
    integrations.push("GitHub auth");
  }

  return integrations;
}

function getCasualResponse(message: string): string | undefined {
  const normalized = message.trim().toLowerCase();

  if (/^(thanks|thank you|thx)\b/.test(normalized)) {
    return "You're welcome. Tell me what you want to adjust next, or start a new conversation when you're ready for another app.";
  }

  if (/\bhow are you\b/.test(normalized)) {
    return "I'm doing well and ready to help with an app plan. What kind of app do you want to build, and what should it help users do?";
  }

  if (/\bwhat(?:'s| is) your name\b/.test(normalized)) {
    return "I'm the app-building assistant for this workspace. Tell me what kind of app you want to build and the problem it should solve.";
  }

  if (/\bwhere do you live\b/.test(normalized)) {
    return "I run inside this local app-building chatbot service. Tell me what you want to create and who it is for.";
  }

  if (/\btell me (?:a )?joke\b/.test(normalized)) {
    return "I'm focused on helping you define an app build. Tell me the kind of app you want and the problem it should solve.";
  }

  if (/^(hi|hello|hey)\b/.test(normalized)) {
    return "Hi. Tell me what kind of app you want to build and what problem it should solve.";
  }

  return undefined;
}

function getCreatedConversationResponse(message: string, state: ConversationState): string {
  const normalized = message.trim().toLowerCase();
  const appLocation = state.createdAppUrl ? ` at ${state.createdAppUrl}` : "";

  if (/^(thanks|thank you|thx)\b/.test(normalized)) {
    return `You're welcome. The created app is still available${appLocation}.`;
  }

  return `This app has already been created${appLocation}. Use New to start a revised app or another build.`;
}

function countExtractedFields(extracted: Partial<AppSpec>): number {
  return Object.values(extracted).filter((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value !== undefined && value !== null && value !== "";
  }).length;
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== undefined && value !== null && value !== "";
}
