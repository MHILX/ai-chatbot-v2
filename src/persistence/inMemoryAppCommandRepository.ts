import type { AppCommandRecord } from "../workflow/appCommand";
import type { AppCommandRepository } from "./appCommandRepository";

export class InMemoryAppCommandRepository implements AppCommandRepository {
  private readonly recordsByCommandId = new Map<string, AppCommandRecord>();
  private readonly executionLocks = new Set<string>();

  async get(commandId: string): Promise<AppCommandRecord | undefined> {
    const record = this.recordsByCommandId.get(commandId);
    return record ? structuredClone(record) : undefined;
  }

  async save(record: AppCommandRecord): Promise<void> {
    this.recordsByCommandId.set(record.command.id, structuredClone(record));
  }

  async listByConversationId(conversationId: string): Promise<AppCommandRecord[]> {
    return [...this.recordsByCommandId.values()]
      .filter((record) => record.command.conversationId === conversationId)
      .map((record) => structuredClone(record))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async tryAcquireExecutionLock(commandId: string): Promise<boolean> {
    if (this.executionLocks.has(commandId)) {
      return false;
    }

    this.executionLocks.add(commandId);
    return true;
  }

  async releaseExecutionLock(commandId: string): Promise<void> {
    this.executionLocks.delete(commandId);
  }
}