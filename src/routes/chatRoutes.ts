import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppBuilderClient } from "../appBuilder/appBuilderClient";
import type { LlmClient } from "../llm/llmClient";
import type { ConversationRepository } from "../persistence/conversationRepository";
import { handleChatTurn } from "../workflow/handleChatTurn";

const chatRequestSchema = z.object({
  conversationId: z.string().min(1),
  userId: z.string().min(1).optional().nullable(),
  message: z.string().trim().min(1)
});

export interface ChatRouteDependencies {
  repository: ConversationRepository;
  llmClient: LlmClient;
  appBuilder: AppBuilderClient;
}

export async function registerChatRoutes(server: FastifyInstance, dependencies: ChatRouteDependencies): Promise<void> {
  server.post("/api/chat", async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid chat request.",
        details: parsed.error.flatten()
      });
    }

    try {
      const response = await handleChatTurn({
        ...parsed.data,
        repository: dependencies.repository,
        llmClient: dependencies.llmClient,
        appBuilder: dependencies.appBuilder
      });

      return reply.send(response);
    } catch (error) {
      request.log.error({ error }, "Chat turn failed");
      return reply.code(500).send({
        error: "The chatbot could not process the message."
      });
    }
  });
}
