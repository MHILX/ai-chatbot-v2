import type { AppSpec, AppSpecField, AppType } from "./appSpec";

const requiredFields: Record<AppType, AppSpecField[]> = {
  crud: ["purpose", "targetUsers", "dataEntities", "coreFeatures"],
  dashboard: ["purpose", "targetUsers", "dataEntities", "coreFeatures"],
  workflow: ["purpose", "targetUsers", "coreFeatures", "workflowSteps"],
  chatbot: ["purpose", "targetUsers", "dataEntities"],
  portal: ["purpose", "targetUsers", "coreFeatures", "authRequired"],
  other: ["purpose", "targetUsers", "coreFeatures"]
};

const vaguePurposes = new Set(["app", "application", "dashboard", "workflow", "crud", "chatbot", "portal", "tool", "system"]);

export function getRequiredFields(appType: AppType): AppSpecField[] {
  return requiredFields[appType];
}

export function getMissingFields(spec: AppSpec): AppSpecField[] {
  const missing = new Set<AppSpecField>();

  if (!spec.appType) {
    missing.add("appType");
  }

  if (isPurposeMissing(spec)) {
    missing.add("purpose");
  }

  const fieldsToCheck = spec.appType ? getRequiredFields(spec.appType) : [];

  for (const field of fieldsToCheck) {
    if (isFieldMissing(spec, field)) {
      missing.add(field);
    }
  }

  return [...missing];
}

export function isReadyToBuild(spec: AppSpec): boolean {
  return getMissingFields(spec).length === 0;
}

function isPurposeMissing(spec: AppSpec): boolean {
  const purpose = spec.purpose?.trim().toLowerCase();
  if (!purpose) {
    return true;
  }

  if (vaguePurposes.has(purpose)) {
    return true;
  }

  return spec.appType ? purpose === spec.appType : false;
}

function isFieldMissing(spec: AppSpec, field: AppSpecField): boolean {
  const value = spec[field];

  if (field === "purpose") {
    return isPurposeMissing(spec);
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return value === null || value === undefined || value === "";
}
