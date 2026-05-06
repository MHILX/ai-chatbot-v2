import type { AppBuilderClient } from "../appBuilder/appBuilderClient";
import type { AppSpec } from "../domain/appSpec";
import { classifyConfirmationDeterministically, type ConfirmationDecision } from "../domain/confirmation";
import {
  appendMessage,
  createConversationState,
  type ConversationState,
  type ConversationStatus
} from "../domain/conversationState";
import { mergeAppSpec } from "../domain/mergeAppSpec";
import { getMissingFields } from "../domain/validation";
import type { LlmClient } from "../llm/llmClient";
import type { ConversationRepository } from "../persistence/conversationRepository";
import { createAppFromState } from "./createAppFromState";

export interface HandleChatTurnInput {
  conversationId: string;
  userId?: string | null;
  message: string;
  repository: ConversationRepository;
  llmClient: LlmClient;
  appBuilder: AppBuilderClient;
}

export interface ChatTurnResponse {
  conversationId: string;
  status: ConversationStatus;
  message: string;
  appSpec: AppSpec;
  missingFields: string[];
  createdApp?: {
    appId: string;
    url: string;
  };
}

export async function handleChatTurn(input: HandleChatTurnInput): Promise<ChatTurnResponse> {
  const state = (await input.repository.get(input.conversationId)) ?? createConversationState(input.conversationId, input.userId);
  state.userId = input.userId ?? state.userId ?? null;
  appendMessage(state, "user", input.message);

  if (state.status === "awaiting_confirmation") {
    return handleConfirmationTurn(state, input);
  }

  const extracted = await input.llmClient.extractAppSpec({
    userMessage: input.message,
    currentSpec: state.appSpec,
    missingFields: state.missingFields
  });

  state.appSpec = mergeAppSpec(state.appSpec, extracted);
  state.missingFields = getMissingFields(state.appSpec);

  if (state.missingFields.length > 0) {
    state.readyToBuild = false;
    state.confirmed = false;
    state.status = "collecting_requirements";

    const response = await input.llmClient.generateClarifyingQuestion({
      appSpec: state.appSpec,
      missingFields: state.missingFields
    });

    return saveAndRespond(input.repository, state, response);
  }

  state.readyToBuild = true;
  state.confirmed = false;
  state.status = "awaiting_confirmation";

  const response = await input.llmClient.generateConfirmationSummary({ appSpec: state.appSpec });
  return saveAndRespond(input.repository, state, response);
}

async function handleConfirmationTurn(state: ConversationState, input: HandleChatTurnInput): Promise<ChatTurnResponse> {
  const decision = await classifyConfirmation(state, input);

  if (decision === "no") {
    state.confirmed = false;
    state.readyToBuild = false;
    state.status = "collecting_requirements";
    return saveAndRespond(input.repository, state, "No problem. What would you like to change?");
  }

  if (decision === "ambiguous") {
    return saveAndRespond(input.repository, state, "Please reply yes to create the app, or no if you want to change the requirements.");
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
    return saveAndRespond(input.repository, state, response);
  }

  try {
    const result = await createAppFromState(state, input.appBuilder);
    state.status = "created";
    state.createdAppId = result.appId;
    state.createdAppUrl = result.url;
    return saveAndRespond(input.repository, state, `Created the app. You can open it at ${result.url}.`, {
      appId: result.appId,
      url: result.url
    });
  } catch {
    state.status = "failed";
    return saveAndRespond(input.repository, state, "I could not create the app because the app builder failed. Your requirements are saved, so you can try again in a moment.");
  }
}

async function classifyConfirmation(state: ConversationState, input: HandleChatTurnInput): Promise<ConfirmationDecision> {
  const deterministic = classifyConfirmationDeterministically(input.message);
  if (deterministic !== "ambiguous") {
    return deterministic;
  }

  return input.llmClient.classifyConfirmation({
    userMessage: input.message,
    appSpec: state.appSpec
  });
}

async function saveAndRespond(
  repository: ConversationRepository,
  state: ConversationState,
  message: string,
  createdApp?: ChatTurnResponse["createdApp"]
): Promise<ChatTurnResponse> {
  appendMessage(state, "assistant", message);
  await repository.save(state);

  return {
    conversationId: state.conversationId,
    status: state.status,
    message,
    appSpec: state.appSpec,
    missingFields: state.missingFields,
    createdApp
  };
}
