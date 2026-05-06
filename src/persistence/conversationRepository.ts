import type { ConversationState } from "../domain/conversationState";

export interface ConversationRepository {
  get(conversationId: string): Promise<ConversationState | undefined>;
  save(state: ConversationState): Promise<void>;
}
