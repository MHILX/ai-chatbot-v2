import { z } from "zod";
import { appTypes, type AppSpec } from "./appSpec";

const stringFieldSchema = z.string().trim().min(1);

export const userPreferencesSchema = z.object({
  userId: stringFieldSchema,
  preferredAppType: z.enum(appTypes).optional().nullable(),
  preferredDeploymentTarget: stringFieldSchema.optional().nullable(),
  preferredAuthRequired: z.boolean().optional().nullable(),
  preferredIntegrations: z.array(stringFieldSchema).default([]),
  updatedAt: z.string()
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export function createUserPreferences(userId: string, updatedAt = new Date().toISOString()): UserPreferences {
  return userPreferencesSchema.parse({
    userId,
    updatedAt
  });
}

export function mergeUserPreferencesFromAppSpec(existing: UserPreferences, appSpec: AppSpec): UserPreferences {
  const next: UserPreferences = {
    ...existing,
    preferredIntegrations: [...existing.preferredIntegrations]
  };

  if (appSpec.appType) {
    next.preferredAppType = appSpec.appType;
  }

  if (appSpec.deploymentTarget) {
    next.preferredDeploymentTarget = appSpec.deploymentTarget;
  }

  if (appSpec.authRequired !== undefined && appSpec.authRequired !== null) {
    next.preferredAuthRequired = appSpec.authRequired;
  }

  if (appSpec.integrations.length > 0) {
    next.preferredIntegrations = mergePreferenceList(next.preferredIntegrations, appSpec.integrations);
  }

  next.updatedAt = new Date().toISOString();
  return userPreferencesSchema.parse(next);
}

function mergePreferenceList(existing: string[], incoming: string[]): string[] {
  const valuesByKey = new Map<string, string>();

  for (const value of [...existing, ...incoming]) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (!valuesByKey.has(key)) {
      valuesByKey.set(key, trimmed);
    }
  }

  return [...valuesByKey.values()];
}