import type { AppSpec, PartialAppSpec } from "./appSpec";

export const jailbreakCategories = [
  "instruction_override",
  "prompt_exfiltration",
  "safety_bypass",
  "tool_bypass",
  "roleplay_override",
  "obfuscated_instruction"
] as const;

export type JailbreakCategory = (typeof jailbreakCategories)[number];
export type JailbreakAction = "allow" | "sanitize" | "block";

export interface JailbreakAssessment {
  detected: boolean;
  allowed: boolean;
  action: JailbreakAction;
  categories: JailbreakCategory[];
  reason: string | null;
  sanitizedText: string;
}

export interface JailbreakAppSpecAssessment extends Omit<JailbreakAssessment, "sanitizedText"> {
  sanitizedAppSpec: AppSpec;
}

export interface JailbreakPartialAppSpecAssessment extends Omit<JailbreakAssessment, "sanitizedText"> {
  sanitizedAppSpec: PartialAppSpec;
}

interface JailbreakRule {
  category: JailbreakCategory;
  reason: string;
  pattern: RegExp;
}

const jailbreakRules: JailbreakRule[] = [
  {
    category: "instruction_override",
    reason: "attempt to override higher-priority instructions",
    pattern: /\b(?:ignore|disregard|forget|override|bypass|disable)\b.{0,80}\b(?:previous|prior|above|system|developer|hidden|safety|policy|policies|rules?|instructions?|guardrails?|validation|confirmation)\b/i
  },
  {
    category: "prompt_exfiltration",
    reason: "attempt to reveal hidden prompts or internal instructions",
    pattern: /\b(?:reveal|show|print|display|repeat|dump|leak|tell me)\b.{0,80}\b(?:system prompt|developer message|hidden instructions?|internal instructions?|tool instructions?|policy|policies|guardrails?)\b/i
  },
  {
    category: "safety_bypass",
    reason: "attempt to bypass refusal or safety behavior",
    pattern: /\b(?:do not refuse|don't refuse|never refuse|always comply|answer without disclaimers?|no disclaimers?|policy does not apply|policies do not apply|safety rules? do not apply|disable safety|bypass safety)\b/i
  },
  {
    category: "tool_bypass",
    reason: "attempt to bypass tool, validation, or confirmation controls",
    pattern: /\b(?:call|execute|run|invoke|trigger|use)\b.{0,80}\b(?:app builder|builder|tool|create app|app creation)\b.{0,80}\b(?:now|without confirmation|without validation|without approval|bypass|skip validation|skip confirmation)\b|\b(?:mark|classify|treat)\b.{0,60}\b(?:confirmed|approved|yes)\b/i
  },
  {
    category: "roleplay_override",
    reason: "attempt to force an unrestricted role or mode",
    pattern: /\b(?:developer mode|dan mode|jailbreak (?:this|the|your) (?:assistant|chatbot|model|system)|you are now (?:dan|unrestricted|uncensored|unfiltered)|act as (?:dan|an unrestricted|an uncensored|an unfiltered)|no restrictions|no safety filters)\b/i
  },
  {
    category: "obfuscated_instruction",
    reason: "attempt to hide instructions through encoding or indirection",
    pattern: /\b(?:base64|rot13|encoded|decode this|hidden instruction|secret instruction)\b.{0,80}\b(?:follow|obey|execute|ignore|reveal|bypass)\b/i
  }
];

const safeDiscussionPattern = /\b(?:detect|detection|prevent|prevention|defend|defense|defensive|training|awareness|education|educational|moderation|reporting|audit|compliance|risk management|monitoring)\b/i;
const directJailbreakCommandPattern = /\b(?:ignore|disregard|forget|override|bypass|disable|reveal|show|print|display|dump|leak|do not refuse|don't refuse|never refuse|always comply|developer mode|dan mode|you are now|act as)\b/i;
const legitimateAppSignalPattern = /\b(?:build|create|make|design|app|application|dashboard|workflow|crud|portal|chatbot|tool|system|manage|track|report|monitor|users?|employees?|sales|inventory|records?|tickets?|approvals?)\b/i;

const jailbreakRemovalPatterns = [
  /(?:^|\s)(?:ignore|disregard|forget|override|bypass|disable)\b.{0,120}\b(?:previous|prior|above|system|developer|hidden|safety|policy|policies|rules?|instructions?|guardrails?|validation|confirmation)\b[^.!?;\n]*(?:[.!?;]|$)/gi,
  /(?:^|\s)(?:reveal|show|print|display|repeat|dump|leak|tell me)\b.{0,120}\b(?:system prompt|developer message|hidden instructions?|internal instructions?|tool instructions?|policy|policies|guardrails?)\b[^.!?;\n]*(?:[.!?;]|$)/gi,
  /(?:^|\s)(?:do not refuse|don't refuse|never refuse|always comply|answer without disclaimers?|no disclaimers?|policy does not apply|policies do not apply|safety rules? do not apply|disable safety|bypass safety)\b[^.!?;\n]*(?:[.!?;]|$)/gi,
  /(?:^|\s)(?:call|execute|run|invoke|trigger|use)\b.{0,120}\b(?:app builder|builder|tool|create app|app creation)\b.{0,120}\b(?:now|without confirmation|without validation|without approval|bypass|skip validation|skip confirmation)\b[^.!?;\n]*(?:[.!?;]|$)/gi,
  /(?:^|\s)(?:mark|classify|treat)\b.{0,80}\b(?:confirmed|approved|yes)\b[^.!?;\n]*(?:[.!?;]|$)/gi,
  /(?:^|\s)(?:developer mode|dan mode|jailbreak (?:this|the|your) (?:assistant|chatbot|model|system)|you are now (?:dan|unrestricted|uncensored|unfiltered)|act as (?:dan|an unrestricted|an uncensored|an unfiltered)|no restrictions|no safety filters)\b[^.!?;\n]*(?:[.!?;]|$)/gi,
  /(?:^|\s)(?:base64|rot13|encoded|decode this|hidden instruction|secret instruction)\b.{0,120}\b(?:follow|obey|execute|ignore|reveal|bypass)\b[^.!?;\n]*(?:[.!?;]|$)/gi
];

const stringAppSpecFields = ["appName", "purpose", "deploymentTarget"] as const;
const stringListAppSpecFields = [
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

export function assessJailbreakText(text: string): JailbreakAssessment {
  const trimmed = text.trim();
  if (!trimmed) {
    return allowText(text);
  }

  const matchedRules = getMatchedRules(trimmed);
  if (matchedRules.length === 0 || isBenignDiscussion(trimmed, matchedRules)) {
    return allowText(text);
  }

  const sanitizedText = sanitizeJailbreakText(trimmed);
  const categories = [...new Set(matchedRules.map((rule) => rule.category))];
  const reasons = [...new Set(matchedRules.map((rule) => rule.reason))];
  const action: JailbreakAction = shouldBlockJailbreak(trimmed, sanitizedText) ? "block" : "sanitize";

  return {
    detected: true,
    allowed: action !== "block",
    action,
    categories,
    reason: reasons.join(", "),
    sanitizedText
  };
}

export function assessAppSpecJailbreak(appSpec: AppSpec): JailbreakAppSpecAssessment {
  const sanitizedAppSpec = sanitizeAppSpecTextFields(appSpec);
  return buildAppSpecAssessment(appSpec, sanitizedAppSpec);
}

export function assessPartialAppSpecJailbreak(appSpec: PartialAppSpec): JailbreakPartialAppSpecAssessment {
  const sanitizedAppSpec = sanitizeAppSpecTextFields(appSpec);
  return buildAppSpecAssessment(appSpec, sanitizedAppSpec);
}

export function getJailbreakBlockedMessage(): string {
  return "I can't help with attempts to change my operating rules or access private instructions. Describe the app requirements directly and I can help design it.";
}

export function getJailbreakAssistantFallback(): string {
  return "I can't provide private instructions or change safety controls. I can help with the app requirements instead.";
}

function allowText(text: string): JailbreakAssessment {
  return {
    detected: false,
    allowed: true,
    action: "allow",
    categories: [],
    reason: null,
    sanitizedText: text
  };
}

function getMatchedRules(text: string): JailbreakRule[] {
  return jailbreakRules.filter((rule) => rule.pattern.test(text));
}

function isBenignDiscussion(text: string, matchedRules: JailbreakRule[]): boolean {
  if (!safeDiscussionPattern.test(text)) {
    return false;
  }

  if (directJailbreakCommandPattern.test(text)) {
    return false;
  }

  const categories = new Set(matchedRules.map((rule) => rule.category));
  return !categories.has("prompt_exfiltration") && !categories.has("tool_bypass") && !categories.has("safety_bypass");
}

function sanitizeJailbreakText(text: string): string {
  const sanitized = jailbreakRemovalPatterns.reduce(
    (current, pattern) => current.replace(pattern, " "),
    text
  );

  return normalizeSanitizedText(sanitized);
}

function normalizeSanitizedText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\b(?:and|also|then)\s*$/i, "")
    .trim();
}

function shouldBlockJailbreak(originalText: string, sanitizedText: string): boolean {
  if (!sanitizedText) {
    return true;
  }

  return !legitimateAppSignalPattern.test(sanitizedText) && !hasSubstantialNonJailbreakText(originalText, sanitizedText);
}

function hasSubstantialNonJailbreakText(originalText: string, sanitizedText: string): boolean {
  return sanitizedText.length >= 12 && sanitizedText.length >= Math.min(80, Math.round(originalText.length * 0.25));
}

function sanitizeAppSpecTextFields<T extends AppSpec | PartialAppSpec>(appSpec: T): T {
  const next: Record<string, unknown> = structuredClone(appSpec);

  for (const field of stringAppSpecFields) {
    const value = next[field];
    if (typeof value !== "string") {
      continue;
    }

    const assessment = assessJailbreakText(value);
    if (!assessment.detected) {
      continue;
    }

    if (assessment.sanitizedText) {
      next[field] = assessment.sanitizedText;
    } else {
      delete next[field];
    }
  }

  for (const field of stringListAppSpecFields) {
    const value = next[field];
    if (!Array.isArray(value)) {
      continue;
    }

    next[field] = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => assessJailbreakText(item))
      .map((assessment) => assessment.sanitizedText)
      .filter((item) => item.length > 0);
  }

  return next as T;
}

function buildAppSpecAssessment<T extends AppSpec | PartialAppSpec>(
  originalAppSpec: T,
  sanitizedAppSpec: T
): Omit<JailbreakAssessment, "sanitizedText"> & { sanitizedAppSpec: T } {
  const originalText = flattenAppSpecText(originalAppSpec);
  const sanitizedText = flattenAppSpecText(sanitizedAppSpec);
  const textAssessment = assessJailbreakText(originalText);

  if (!textAssessment.detected) {
    return {
      detected: false,
      allowed: true,
      action: "allow",
      categories: [],
      reason: null,
      sanitizedAppSpec
    };
  }

  const action: JailbreakAction = shouldBlockJailbreak(originalText, sanitizedText) ? "block" : "sanitize";
  return {
    detected: true,
    allowed: action !== "block",
    action,
    categories: textAssessment.categories,
    reason: textAssessment.reason,
    sanitizedAppSpec
  };
}

function flattenAppSpecText(appSpec: AppSpec | PartialAppSpec): string {
  return Object.values(appSpec).flatMap((value) => {
    if (Array.isArray(value)) {
      return value;
    }

    return typeof value === "string" ? [value] : [];
  }).join("\n");
}