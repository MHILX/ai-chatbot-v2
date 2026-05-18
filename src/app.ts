import fastify from "fastify";
import type { AppBuilderClient } from "./appBuilder/appBuilderClient";
import { MockAppBuilderClient } from "./appBuilder/mockAppBuilderClient";
import type { AppConfig } from "./config";
import type { ContextWindowOptions } from "./domain/contextWindow";
import { BedrockLlmClient } from "./llm/bedrockLlmClient";
import type { LlmClient } from "./llm/llmClient";
import { InMemoryTelemetryAggregator } from "./observability/inMemoryTelemetryAggregator";
import { createLoggerOptions } from "./observability/logger";
import { createCompositeTelemetry, createLoggerTelemetry } from "./observability/telemetry";
import type { AppCommandRepository } from "./persistence/appCommandRepository";
import { InMemoryConversationRepository } from "./persistence/inMemoryConversationRepository";
import { InMemoryAppCommandRepository } from "./persistence/inMemoryAppCommandRepository";
import { InMemoryUserPreferencesRepository } from "./persistence/inMemoryUserPreferencesRepository";
import type { ConversationRepository } from "./persistence/conversationRepository";
import type { UserPreferencesRepository } from "./persistence/userPreferencesRepository";
import { registerChatRoutes } from "./routes/chatRoutes";
import { registerMetricsRoutes } from "./routes/metricsRoutes";
import { registerRuntimeRoutes } from "./routes/runtimeRoutes";
import { registerUiRoutes } from "./routes/uiRoutes";

export interface BuildAppOptions {
  config: AppConfig;
  repository?: ConversationRepository;
  userPreferencesRepository?: UserPreferencesRepository;
  commandRepository?: AppCommandRepository;
  llmClient?: LlmClient;
  appBuilder?: AppBuilderClient;
  metrics?: InMemoryTelemetryAggregator;
}

export async function buildApp(options: BuildAppOptions) {
  const server = fastify({ logger: createLoggerOptions(options.config) });
  const repository = options.repository ?? new InMemoryConversationRepository();
  const userPreferencesRepository = options.userPreferencesRepository ?? new InMemoryUserPreferencesRepository();
  const commandRepository = options.commandRepository ?? new InMemoryAppCommandRepository();
  const metrics = options.metrics ?? new InMemoryTelemetryAggregator();
  const telemetry = createCompositeTelemetry(createLoggerTelemetry(server.log), metrics);
  const llmClient = options.llmClient ?? new BedrockLlmClient(options.config, telemetry);
  const appBuilder = options.appBuilder ?? new MockAppBuilderClient();
  const contextWindow: ContextWindowOptions = {
    maxTokens: options.config.bedrockContextWindowTokens,
    warningRatio: options.config.bedrockContextWindowWarningRatio,
    blockRatio: options.config.bedrockContextWindowBlockRatio
  };

  server.get("/health", async () => ({ status: "ok" }));

  await registerRuntimeRoutes(server, options.config);
  await registerMetricsRoutes(server, { metrics });
  await registerChatRoutes(server, {
    repository,
    userPreferencesRepository,
    commandRepository,
    llmClient,
    appBuilder,
    contextWindow,
    telemetry: metrics
  });
  await registerUiRoutes(server);

  return server;
}
