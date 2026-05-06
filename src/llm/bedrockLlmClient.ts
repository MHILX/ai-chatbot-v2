import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { partialAppSpecSchema, type PartialAppSpec } from "../domain/appSpec";
import type { ConfirmationDecision } from "../domain/confirmation";
import type { AppConfig } from "../config";
import type {
  ClarifyingQuestionInput,
  ConfirmationInput,
  ConfirmationSummaryInput,
  ExtractAppSpecInput,
  LlmClient
} from "./llmClient";
import {
  buildClarifyingQuestionPrompt,
  buildConfirmationClassificationPrompt,
  buildConfirmationSummaryPrompt,
  buildExtractionPrompt,
  buildJsonRepairPrompt
} from "./prompts";
import { parseJsonWithSchema } from "./structuredJson";
import { normalizeAssistantText } from "./textOutput";

export class BedrockLlmClient implements LlmClient {
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly config: AppConfig) {
    this.client = new BedrockRuntimeClient({ region: config.awsRegion });
  }

  async extractAppSpec(input: ExtractAppSpecInput): Promise<PartialAppSpec> {
    const text = await this.sendText(
      "You extract structured app requirements and return strict JSON.",
      buildExtractionPrompt(input.userMessage, input.currentSpec, input.missingFields)
    );

    try {
      return parseJsonWithSchema(text, partialAppSpecSchema);
    } catch {
      const repaired = await this.sendText(
        "You repair malformed JSON and return strict JSON only.",
        buildJsonRepairPrompt(text)
      );

      try {
        return parseJsonWithSchema(repaired, partialAppSpecSchema);
      } catch {
        return {};
      }
    }
  }

  async generateClarifyingQuestion(input: ClarifyingQuestionInput): Promise<string> {
    const text = await this.sendText(
      "You ask concise product requirements questions.",
      buildClarifyingQuestionPrompt(input.appSpec, input.missingFields)
    );
    return normalizeAssistantText(text);
  }

  async generateConfirmationSummary(input: ConfirmationSummaryInput): Promise<string> {
    const text = await this.sendText(
      "You summarize app specifications for final confirmation.",
      buildConfirmationSummaryPrompt(input.appSpec)
    );
    return normalizeAssistantText(text);
  }

  async classifyConfirmation(input: ConfirmationInput): Promise<ConfirmationDecision> {
    const text = await this.sendText(
      "You classify confirmation replies.",
      buildConfirmationClassificationPrompt(input.userMessage, input.appSpec),
      20
    );

    const normalized = text.trim().toLowerCase();
    if (normalized === "yes" || normalized === "no" || normalized === "ambiguous") {
      return normalized;
    }

    return "ambiguous";
  }

  private async sendText(systemPrompt: string, userPrompt: string, maxTokens = this.config.bedrockMaxTokens): Promise<string> {
    const command = new ConverseCommand({
      modelId: this.config.bedrockModelId,
      system: [{ text: systemPrompt }],
      messages: [
        {
          role: "user",
          content: [{ text: userPrompt }]
        }
      ],
      inferenceConfig: {
        maxTokens,
        temperature: this.config.bedrockTemperature
      }
    });

    const response = await this.client.send(command);
    const content = response.output?.message?.content ?? [];
    return content.map((block) => block.text ?? "").join("\n").trim();
  }
}
