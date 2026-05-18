import { describe, expect, it } from "vitest";
import { InMemoryTelemetryAggregator } from "../../src/observability/inMemoryTelemetryAggregator";

describe("InMemoryTelemetryAggregator", () => {
  it("aggregates chat, extraction, confirmation, and app creation metrics", () => {
    const telemetry = new InMemoryTelemetryAggregator();

    telemetry.event("chat_turn_started", { conversationId: "conv_1" });
    telemetry.event("chat_turn_completed", { conversationId: "conv_1", status: "created" });
    telemetry.metric("chat_turn_latency_ms", 42, { conversationId: "conv_1", status: "created" });
    telemetry.metric("chat_turn_failure_count", 1, { conversationId: "conv_2" });
    telemetry.metric("llm_request_failure_count", 1, { task: "extract_app_spec" });
    telemetry.metric("llm_structured_output_failure_count", 2, { task: "extract_app_spec" });
    telemetry.metric("llm_structured_output_repair_failure_count", 1, { task: "extract_app_spec" });
    telemetry.event("confirmation_requested", { conversationId: "conv_1" });
    telemetry.metric("confirmation_decision_count", 1, { decision: "yes" });
    telemetry.metric("confirmation_decision_count", 1, { decision: "ambiguous" });
    telemetry.metric("app_creation_success_count", 1, { conversationId: "conv_1" });
    telemetry.metric("app_creation_failure_count", 1, { conversationId: "conv_2" });
    telemetry.metric("app_builder_latency_ms", 150, { conversationId: "conv_1" });
    telemetry.metric("sensitive_data_redaction_count", 2, { boundary: "user_message" });
    telemetry.metric("sensitive_data_redaction_count", 1, { boundary: "app_builder_result" });
    telemetry.metric("content_safety_block_count", 1, { boundary: "user_message", categories: ["cyber_abuse"] });
    telemetry.metric("jailbreak_attempt_count", 1, { boundary: "user_message", outcome: "blocked", categories: ["prompt_exfiltration"] });
    telemetry.metric("jailbreak_attempt_count", 1, { boundary: "llm_extraction", outcome: "sanitized", categories: ["instruction_override"] });

    expect(telemetry.snapshot()).toMatchObject({
      turns: {
        started: 1,
        completed: 1,
        failed: 1,
        byStatus: {
          created: 1
        },
        latencyMs: {
          count: 1,
          averageMs: 42,
          maxMs: 42,
          lastMs: 42
        }
      },
      extractionFailures: {
        requestFailures: 1,
        structuredOutputFailures: 2,
        repairFailures: 1,
        total: 4
      },
      confirmations: {
        requested: 1,
        decisions: {
          yes: 1,
          no: 0,
          ambiguous: 1
        },
        totalDecisions: 2
      },
      appCreation: {
        success: 1,
        failure: 1,
        total: 2,
        latencyMs: {
          count: 1,
          averageMs: 150,
          maxMs: 150,
          lastMs: 150
        }
      },
      privacy: {
        redactions: 3,
        byBoundary: {
          user_message: 2,
          app_builder_result: 1
        }
      },
      contentSafety: {
        blocked: 1,
        byBoundary: {
          user_message: 1
        },
        byCategory: {
          cyber_abuse: 1
        }
      },
      jailbreakResistance: {
        detected: 2,
        blocked: 1,
        sanitized: 1,
        byBoundary: {
          user_message: 1,
          llm_extraction: 1
        },
        byCategory: {
          prompt_exfiltration: 1,
          instruction_override: 1
        }
      }
    });
  });
});