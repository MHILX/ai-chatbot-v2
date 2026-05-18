import type { UserPreferencesRepository } from "./userPreferencesRepository";
import type { UserPreferences } from "../domain/userPreferences";

export class InMemoryUserPreferencesRepository implements UserPreferencesRepository {
  private readonly preferencesByUserId = new Map<string, UserPreferences>();

  async get(userId: string): Promise<UserPreferences | undefined> {
    const preferences = this.preferencesByUserId.get(userId);
    return preferences ? structuredClone(preferences) : undefined;
  }

  async save(preferences: UserPreferences): Promise<void> {
    this.preferencesByUserId.set(preferences.userId, structuredClone(preferences));
  }
}