import type { AppSpec, PartialAppSpec } from "../domain/appSpec";

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

export interface LlmClient {
  extractAppSpec(input: ExtractAppSpecInput): Promise<PartialAppSpec>;
  generateClarifyingQuestion(input: ClarifyingQuestionInput): Promise<string>;
  generateConfirmationSummary(input: ConfirmationSummaryInput): Promise<string>;
}
