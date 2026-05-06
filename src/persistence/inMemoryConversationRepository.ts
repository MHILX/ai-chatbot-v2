import type { ConversationState } from "../domain/conversationState";
import type { ConversationRepository } from "./conversationRepository";

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, ConversationState>();

  async get(conversationId: string): Promise<ConversationState | undefined> {
    const state = this.conversations.get(conversationId);
    return state ? structuredClone(state) : undefined;
  }

  async save(state: ConversationState): Promise<void> {
    this.conversations.set(state.conversationId, structuredClone(state));
  }
}
