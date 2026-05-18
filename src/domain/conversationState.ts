import { z } from "zod";
import { appSpecSchema, createEmptyAppSpec } from "./appSpec";

export const conversationStatuses = [
  "collecting_requirements",
  "awaiting_confirmation",
  "creating_app",
  "created",
  "blocked",
  "failed",
  "cancelled"
] as const;

export const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.string()
});

export const conversationStateSchema = z.object({
  conversationId: z.string().min(1),
  userId: z.string().min(1).optional().nullable(),
  messages: z.array(messageSchema).default([]),
  appSpec: appSpecSchema.default(createEmptyAppSpec),
  missingFields: z.array(z.string()).default([]),
  confirmed: z.boolean().default(false),
  readyToBuild: z.boolean().default(false),
  createdAppId: z.string().optional().nullable(),
  createdAppUrl: z.string().optional().nullable(),
  status: z.enum(conversationStatuses).default("collecting_requirements")
});

export type ConversationStatus = (typeof conversationStatuses)[number];
export type ChatMessage = z.infer<typeof messageSchema>;
export type ConversationState = z.infer<typeof conversationStateSchema>;

export function createConversationState(conversationId: string, userId?: string | null): ConversationState {
  return conversationStateSchema.parse({
    conversationId,
    userId: userId ?? null,
    appSpec: createEmptyAppSpec()
  });
}

export function appendMessage(state: ConversationState, role: ChatMessage["role"], content: string): void {
  state.messages.push({
    role,
    content,
    createdAt: new Date().toISOString()
  });
}
