import type { AppSpec } from "../domain/appSpec";

const supportedAppTypes = ["dashboard", "workflow", "crud", "chatbot", "portal", "other"];

export function buildExtractionPrompt(userMessage: string, currentSpec: AppSpec, missingFields: string[]): string {
  return `Extract app-building requirements from the user's latest message.

Return only valid JSON with camelCase keys. The JSON must be a partial app spec. Do not include markdown.

Supported appType values: ${supportedAppTypes.join(", ")}

Rules:
- Extract only information supported by the latest user message.
- Preserve existing state unless the user clearly corrects it.
- Use null for unknown scalar fields and [] for unknown list fields only when you include those keys.
- Do not invent integrations, roles, entities, or features.
- Prefer concise user-facing wording.

Current app spec:
${JSON.stringify(currentSpec, null, 2)}

Current missing fields:
${JSON.stringify(missingFields)}

Latest user message:
${userMessage}

Return JSON shaped like this when values are known:
{
  "appName": null,
  "purpose": null,
  "appType": null,
  "targetUsers": [],
  "coreFeatures": [],
  "dataEntities": [],
  "integrations": [],
  "authRequired": null,
  "deploymentTarget": null,
  "roles": [],
  "permissions": [],
  "reportingNeeds": [],
  "workflowSteps": [],
  "notes": []
}`;
}

export function buildClarifyingQuestionPrompt(appSpec: AppSpec, missingFields: string[]): string {
  return `You are helping a user define an app to build.

Known app requirements:
${JSON.stringify(appSpec, null, 2)}

Missing required fields:
${JSON.stringify(missingFields)}

Ask at most 3 concise questions in one short paragraph. Prioritize fields required before app creation. If sensible defaults are possible, offer them briefly. Do not ask about anything the user already answered. Do not use markdown headings, bullets, numbered lists, or bold text.`;
}

export function buildConfirmationSummaryPrompt(appSpec: AppSpec): string {
  return `Summarize this app spec for final user confirmation.

App spec:
${JSON.stringify(appSpec, null, 2)}

Write a concise confirmation message in one short paragraph. Mention app type, purpose, users, core features, data entities, integrations, and auth if known. End with a clear yes/no question asking whether to create it now. Do not use markdown headings, bullets, numbered lists, or bold text.`;
}

export function buildConfirmationClassificationPrompt(userMessage: string, appSpec: AppSpec): string {
  return `Classify whether the user confirmed app creation.

Return only one word: yes, no, or ambiguous.

App spec awaiting confirmation:
${JSON.stringify(appSpec, null, 2)}

User reply:
${userMessage}`;
}

export function buildJsonRepairPrompt(rawText: string): string {
  return `Convert the following text into valid JSON for a partial app spec. Return only JSON and no markdown.

Text:
${rawText}`;
}
