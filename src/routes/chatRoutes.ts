import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppBuilderClient } from "../appBuilder/appBuilderClient";
import {
  defaultContextWindowOptions,
  getContextWindowUsage,
  type ContextWindowOptions
} from "../domain/contextWindow";
import type { ConversationState } from "../domain/conversationState";
import type { UserPreferences } from "../domain/userPreferences";
import type { LlmClient } from "../llm/llmClient";
import { createCompositeTelemetry, createLoggerTelemetry, type Telemetry } from "../observability/telemetry";
import type { AppCommandRepository } from "../persistence/appCommandRepository";
import type { ConversationRepository } from "../persistence/conversationRepository";
import type { UserPreferencesRepository } from "../persistence/userPreferencesRepository";
import { getRequiredFieldsForSpec } from "../domain/validation";
import type { AppCommandRecord } from "../workflow/appCommand";
import { handleChatTurn } from "../workflow/handleChatTurn";

const chatRequestSchema = z.object({
  conversationId: z.string().min(1),
  userId: z.string().min(1).optional().nullable(),
  message: z.string().trim().min(1)
});

const conversationParamsSchema = z.object({
  conversationId: z.string().min(1)
});

export interface ChatRouteDependencies {
  repository: ConversationRepository;
  userPreferencesRepository?: UserPreferencesRepository;
  commandRepository?: AppCommandRepository;
  llmClient: LlmClient;
  appBuilder: AppBuilderClient;
  contextWindow?: ContextWindowOptions;
  telemetry?: Telemetry;
}

export async function registerChatRoutes(server: FastifyInstance, dependencies: ChatRouteDependencies): Promise<void> {
  const contextWindow = dependencies.contextWindow ?? defaultContextWindowOptions;

  server.get("/api/conversations/:conversationId", async (request, reply) => {
    const parsed = conversationParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid conversation request.",
        details: parsed.error.flatten()
      });
    }

    let state: ConversationState | undefined;
    try {
      state = await dependencies.repository.get(parsed.data.conversationId);
    } catch (error) {
      request.log.error({ err: error, conversationId: parsed.data.conversationId }, "Conversation load failed");
      return reply.code(500).send({ error: "The conversation could not be loaded." });
    }

    if (!state) {
      return reply.code(404).send({ error: "Conversation not found." });
    }

    const [userPreferences, commands] = await Promise.all([
      state.userId && dependencies.userPreferencesRepository
        ? dependencies.userPreferencesRepository.get(state.userId)
        : undefined,
      dependencies.commandRepository?.listByConversationId(state.conversationId)
    ]);

    return reply.send(serializeConversationState(state, contextWindow, userPreferences, commands));
  });

  server.post("/api/chat", async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid chat request.",
        details: parsed.error.flatten()
      });
    }

    try {
      const telemetry = dependencies.telemetry
        ? createCompositeTelemetry(createLoggerTelemetry(request.log), dependencies.telemetry)
        : createLoggerTelemetry(request.log);

      const response = await handleChatTurn({
        ...parsed.data,
        repository: dependencies.repository,
        userPreferencesRepository: dependencies.userPreferencesRepository,
        commandRepository: dependencies.commandRepository,
        llmClient: dependencies.llmClient,
        appBuilder: dependencies.appBuilder,
        contextWindow,
        telemetry
      });

      return reply.send(response);
    } catch (error) {
      request.log.error({ err: error, conversationId: parsed.data.conversationId, userId: parsed.data.userId ?? null }, "Chat turn failed");
      return reply.code(500).send({
        error: "The chatbot could not process the message."
      });
    }
  });
}

function serializeConversationState(
  state: ConversationState,
  contextWindow: ContextWindowOptions,
  userPreferences?: UserPreferences,
  commands?: AppCommandRecord[]
) {
  return {
    conversationId: state.conversationId,
    status: state.status,
    messages: state.messages,
    appSpec: state.appSpec,
    missingFields: state.missingFields,
    requiredFields: getRequiredFieldsForSpec(state.appSpec),
    contextWindow: getContextWindowUsage(state, contextWindow),
    createdApp: state.createdAppId && state.createdAppUrl ? {
      appId: state.createdAppId,
      url: state.createdAppUrl
    } : undefined,
    userPreferences,
    commands
  };
}
