import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { InMemoryTelemetryAggregator } from "../../src/observability/inMemoryTelemetryAggregator";
import { registerMetricsRoutes } from "../../src/routes/metricsRoutes";

describe("metrics routes", () => {
  it("returns the current in-memory metrics snapshot", async () => {
    const server = fastify();
    const metrics = new InMemoryTelemetryAggregator();

    metrics.event("chat_turn_started", { conversationId: "conv_1" });
    metrics.metric("app_creation_success_count", 1, { conversationId: "conv_1" });
    metrics.metric("sensitive_data_redaction_count", 1, { boundary: "user_message" });
    metrics.metric("content_safety_block_count", 1, { boundary: "user_message", categories: ["cyber_abuse"] });
    metrics.metric("jailbreak_attempt_count", 1, { boundary: "user_message", outcome: "blocked", categories: ["prompt_exfiltration"] });
    await registerMetricsRoutes(server, { metrics });

    const response = await server.inject({
      method: "GET",
      url: "/api/metrics"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      turns: {
        started: 1
      },
      appCreation: {
        success: 1
      },
      privacy: {
        redactions: 1,
        byBoundary: {
          user_message: 1
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
        detected: 1,
        blocked: 1,
        byBoundary: {
          user_message: 1
        },
        byCategory: {
          prompt_exfiltration: 1
        }
      }
    });
  });
});