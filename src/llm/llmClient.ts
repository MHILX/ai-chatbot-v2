import type { AppSpec, PartialAppSpec } from "../domain/appSpec";
import type { ConfirmationDecision } from "../domain/confirmation";

export interface ExtractAppSpecInput {
  userMessage: string;
  currentSpec: AppSpec;
  missingFields: string[];
}

export interface ClarifyingQuestionInput {
  appSpec: AppSpec;
  missingFields: string[];
}

export interface ConfirmationSummaryInput {
  appSpec: AppSpec;
}

export interface ConfirmationInput {
  userMessage: string;
  appSpec: AppSpec;
}

export interface LlmClient {
  extractAppSpec(input: ExtractAppSpecInput): Promise<PartialAppSpec>;
  generateClarifyingQuestion(input: ClarifyingQuestionInput): Promise<string>;
  generateConfirmationSummary(input: ConfirmationSummaryInput): Promise<string>;
  classifyConfirmation(input: ConfirmationInput): Promise<ConfirmationDecision>;
}
