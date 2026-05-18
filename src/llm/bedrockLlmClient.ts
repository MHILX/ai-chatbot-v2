import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { partialAppSpecSchema, type PartialAppSpec } from "../domain/appSpec";
import type { AppConfig } from "../config";
import { getErrorAttributes, noopTelemetry, type Telemetry } from "../observability/telemetry";
import { isRetryableServiceError, withRetry } from "../reliability/retry";
import type {
  ClarifyingQuestionInput,
  ConfirmationSummaryInput,
  ExtractAppSpecInput,
  LlmClient
} from "./llmClient";
import {
  buildClarifyingQuestionPrompt,
  buildConfirmationSummaryPrompt,
  buildExtractionPrompt,
  buildJsonRepairPrompt
} from "./prompts";
import { parseJsonWithSchema } from "./structuredJson";
import { normalizeAssistantText } from "./textOutput";

export class BedrockLlmClient implements LlmClient {
  private readonly client: BedrockRuntimeClient;

  constructor(
    private readonly config: AppConfig,
    private readonly telemetry: Telemetry = noopTelemetry
  ) {
    this.client = new BedrockRuntimeClient({ region: config.awsRegion, maxAttempts: 1 });
  }

  async extractAppSpec(input: ExtractAppSpecInput): Promise<PartialAppSpec> {
    const text = await this.sendText(
      "You extract structured app requirements and return strict JSON.",
      buildExtractionPrompt(input.userMessage, input.currentSpec, input.missingFields)
    );

    try {
      return parseJsonWithSchema(text, partialAppSpecSchema);
    } catch (error) {
      this.telemetry.event("llm_structured_output_validation_failed", {
        task: "extract_app_spec",
        ...getErrorAttributes(error)
      });
      this.telemetry.metric("llm_structured_output_failure_count", 1, {
        task: "extract_app_spec"
      });
      const repaired = await this.sendText(
        "You repair malformed JSON and return strict JSON only.",
        buildJsonRepairPrompt(text)
      );

      try {
        return parseJsonWithSchema(repaired, partialAppSpecSchema);
      } catch (repairError) {
        this.telemetry.event("llm_structured_output_repair_failed", {
          task: "extract_app_spec",
          ...getErrorAttributes(repairError)
        });
        this.telemetry.metric("llm_structured_output_repair_failure_count", 1, {
          task: "extract_app_spec"
        });
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

    const response = await withRetry(() => this.client.send(command), {
      attempts: this.config.bedrockRetryAttempts,
      baseDelayMs: this.config.bedrockRetryBaseDelayMs,
      maxDelayMs: this.config.bedrockRetryMaxDelayMs,
      shouldRetry: isRetryableServiceError,
      onRetry: (error, attempt, delayMs) => {
        this.telemetry.event("bedrock_request_retry_scheduled", {
          modelId: this.config.bedrockModelId,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          ...getErrorAttributes(error)
        });
      }
    });
    const content = response.output?.message?.content ?? [];
    return content.map((block) => block.text ?? "").join("\n").trim();
  }
}
