export type ConfirmationDecision = "yes" | "no" | "ambiguous";

const yesPatterns = [
  /^y$/i,
  /^yes$/i,
  /^yeah$/i,
  /^yep$/i,
  /^sure$/i,
  /^confirmed?$/i,
  /^(go ahead|do it|build it|create it)$/i,
  /^(please build|please create|looks good|that works)$/i
];

const noPatterns = [
  /^n$/i,
  /^no$/i,
  /^nope$/i,
  /^(not yet|wait|cancel|stop)$/i,
  /^(change it|make changes|let me change|need to change)$/i
];

export function classifyConfirmationDeterministically(message: string): ConfirmationDecision {
  const normalized = message.trim();
  if (!normalized) {
    return "ambiguous";
  }

  if (yesPatterns.some((pattern) => pattern.test(normalized))) {
    return "yes";
  }

  if (noPatterns.some((pattern) => pattern.test(normalized))) {
    return "no";
  }

  return "ambiguous";
}
