import type { AppCommandRecord } from "../workflow/appCommand";

export interface AppCommandRepository {
  get(commandId: string): Promise<AppCommandRecord | undefined>;
  save(record: AppCommandRecord): Promise<void>;
  listByConversationId(conversationId: string): Promise<AppCommandRecord[]>;
  tryAcquireExecutionLock(commandId: string): Promise<boolean>;
  releaseExecutionLock(commandId: string): Promise<void>;
}