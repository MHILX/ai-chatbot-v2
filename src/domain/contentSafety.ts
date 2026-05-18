import type { AppSpec, PartialAppSpec } from "./appSpec";

export const contentSafetyCategories = [
  "cyber_abuse",
  "fraud_or_deception",
  "privacy_abuse",
  "violence_or_weapons",
  "hate_or_harassment",
  "sexual_exploitation",
  "self_harm",
  "illegal_activity"
] as const;

export type ContentSafetyCategory = (typeof contentSafetyCategories)[number];

export interface ContentSafetyAssessment {
  allowed: boolean;
  categories: ContentSafetyCategory[];
  reason: string | null;
}

interface ContentSafetyRule {
  category: ContentSafetyCategory;
  reason: string;
  pattern: RegExp;
}

const safeContextPattern = /\b(prevent|prevention|detect|detection|moderate|moderation|report|reporting|block|safety|education|educational|training|awareness|compliance|protect|protection|anti[- ]?|defense|defensive|remediation|response|support|help|hotline|audit|risk management)\b/i;

const contentSafetyRules: ContentSafetyRule[] = [
  {
    category: "cyber_abuse",
    reason: "cyber abuse or credential theft",
    pattern: /\b(phishing kit|credential theft|steal (?:passwords|credentials|tokens|api keys)|keylogger|malware|ransomware|botnet|ddos|session hijack|exploit kit)\b/i
  },
  {
    category: "fraud_or_deception",
    reason: "fraud or deception",
    pattern: /\b(fake (?:login|bank|payment|checkout)|scam(?:ming)?|fraudulent|identity theft|steal (?:credit cards|money|bank details)|launder money|counterfeit)\b/i
  },
  {
    category: "privacy_abuse",
    reason: "privacy abuse or non-consensual surveillance",
    pattern: /\b(stalk|doxx|dox|spyware|secretly (?:track|record|monitor)|track .{0,40} without (?:consent|permission)|surveil .{0,40} without (?:consent|permission))\b/i
  },
  {
    category: "violence_or_weapons",
    reason: "violence or weapons facilitation",
    pattern: /\b(build (?:a )?(?:bomb|weapon)|make (?:a )?(?:bomb|weapon)|explosive device|assassinat|mass shooting|harm people|kill people)\b/i
  },
  {
    category: "hate_or_harassment",
    reason: "hate, harassment, or abuse",
    pattern: /\b(harass|bully|threaten|hate speech|racial slur|target .{0,40}(?:ethnic|religious|racial|protected) group)\b/i
  },
  {
    category: "sexual_exploitation",
    reason: "sexual exploitation or explicit sexual content",
    pattern: /\b(child sexual|minor sexual|sexual exploitation|non-consensual sexual|explicit sexual images|revenge porn|porn(?:ography)?)\b/i
  },
  {
    category: "self_harm",
    reason: "self-harm encouragement",
    pattern: /\b(encourage|promote|help|assist).{0,40}(suicide|self[- ]harm)|suicide challenge\b/i
  },
  {
    category: "illegal_activity",
    reason: "illegal activity facilitation",
    pattern: /\b(sell illegal drugs|drug trafficking|evade law enforcement|bypass sanctions|forge (?:documents|ids)|illegal marketplace)\b/i
  }
];

export function assessContentSafetyText(text: string): ContentSafetyAssessment {
  const trimmed = text.trim();
  if (!trimmed) {
    return allowContent();
  }

  const matchedRules = contentSafetyRules.filter((rule) => rule.pattern.test(trimmed));
  if (matchedRules.length === 0) {
    return allowContent();
  }

  if (safeContextPattern.test(trimmed)) {
    return allowContent();
  }

  return blockContent(matchedRules);
}

export function assessAppSpecSafety(appSpec: AppSpec | PartialAppSpec): ContentSafetyAssessment {
  return assessContentSafetyText(flattenAppSpecText(appSpec));
}

export function getContentSafetyBlockedMessage(): string {
  return "I can't help build apps for harmful, abusive, illegal, or policy-violating purposes. I can help design a safe, compliant app for prevention, reporting, education, or legitimate business workflows.";
}

export function getContentSafetyAssistantFallback(): string {
  return "I can't provide that content. I can help with a safe, compliant app design instead.";
}

function allowContent(): ContentSafetyAssessment {
  return {
    allowed: true,
    categories: [],
    reason: null
  };
}

function blockContent(rules: ContentSafetyRule[]): ContentSafetyAssessment {
  const categories = [...new Set(rules.map((rule) => rule.category))];
  const reasons = [...new Set(rules.map((rule) => rule.reason))];

  return {
    allowed: false,
    categories,
    reason: reasons.join(", ")
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