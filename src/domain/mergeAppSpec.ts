import { appSpecSchema, type AppSpec, type PartialAppSpec } from "./appSpec";

const listFields = [
  "targetUsers",
  "coreFeatures",
  "dataEntities",
  "integrations",
  "roles",
  "permissions",
  "reportingNeeds",
  "workflowSteps",
  "notes"
] as const;

const scalarFields = ["appName", "purpose", "appType", "authRequired", "deploymentTarget"] as const;

export function mergeAppSpec(existing: AppSpec, extracted: PartialAppSpec): AppSpec {
  const next: AppSpec = { ...existing };

  for (const field of scalarFields) {
    const value = extracted[field];
    if (value !== undefined && value !== null && value !== "") {
      next[field] = value as never;
    }
  }

  for (const field of listFields) {
    const value = extracted[field];
    if (value && value.length > 0) {
      next[field] = mergeLists(existing[field], value) as never;
    }
  }

  return appSpecSchema.parse(next);
}

function mergeLists(existing: string[], incoming: string[]): string[] {
  const byKey = new Map<string, string>();

  for (const value of [...existing, ...incoming]) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, trimmed);
    }
  }

  return [...byKey.values()];
}
