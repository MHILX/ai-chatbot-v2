import fastify from "fastify";
import type { AppBuilderClient } from "./appBuilder/appBuilderClient";
import { MockAppBuilderClient } from "./appBuilder/mockAppBuilderClient";
import type { AppConfig } from "./config";
import { BedrockLlmClient } from "./llm/bedrockLlmClient";
import type { LlmClient } from "./llm/llmClient";
import { createLoggerOptions } from "./observability/logger";
import { InMemoryConversationRepository } from "./persistence/inMemoryConversationRepository";
import type { ConversationRepository } from "./persistence/conversationRepository";
import { registerChatRoutes } from "./routes/chatRoutes";
import { registerUiRoutes } from "./routes/uiRoutes";

export interface BuildAppOptions {
  config: AppConfig;
  repository?: ConversationRepository;
  llmClient?: LlmClient;
  appBuilder?: AppBuilderClient;
}

export async function buildApp(options: BuildAppOptions) {
  const server = fastify({ logger: createLoggerOptions(options.config) });
  const repository = options.repository ?? new InMemoryConversationRepository();
  const llmClient = options.llmClient ?? new BedrockLlmClient(options.config);
  const appBuilder = options.appBuilder ?? new MockAppBuilderClient();

  server.get("/health", async () => ({ status: "ok" }));

  await registerChatRoutes(server, { repository, llmClient, appBuilder });
  await registerUiRoutes(server);

  return server;
}
