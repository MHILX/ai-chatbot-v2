import type { UserPreferences } from "../domain/userPreferences";

export interface UserPreferencesRepository {
  get(userId: string): Promise<UserPreferences | undefined>;
  save(preferences: UserPreferences): Promise<void>;
}