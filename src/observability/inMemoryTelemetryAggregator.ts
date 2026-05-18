import type { Telemetry, TelemetryAttributes } from "./telemetry";

export interface LatencyMetricsSnapshot {
  count: number;
  averageMs: number | null;
  maxMs: number | null;
  lastMs: number | null;
}

export interface MetricsSnapshot {
  since: string;
  generatedAt: string;
  lastUpdatedAt: string | null;
  turns: {
    started: number;
    completed: number;
    failed: number;
    byStatus: Record<string, number>;
    latencyMs: LatencyMetricsSnapshot;
  };
  extractionFailures: {
    requestFailures: number;
    structuredOutputFailures: number;
    repairFailures: number;
    total: number;
  };
  confirmations: {
    requested: number;
    decisions: Record<"yes" | "no" | "ambiguous", number>;
    totalDecisions: number;
  };
  appCreation: {
    success: number;
    failure: number;
    total: number;
    latencyMs: LatencyMetricsSnapshot;
  };
  privacy: {
    redactions: number;
    byBoundary: Record<string, number>;
  };
  contentSafety: {
    blocked: number;
    byBoundary: Record<string, number>;
    byCategory: Record<string, number>;
  };
  jailbreakResistance: {
    detected: number;
    blocked: number;
    sanitized: number;
    byBoundary: Record<string, number>;
    byCategory: Record<string, number>;
  };
}

export interface MetricsSnapshotProvider {
  snapshot(): MetricsSnapshot;
}

interface LatencyAccumulator {
  count: number;
  totalMs: number;
  maxMs: number | null;
  lastMs: number | null;
}

export class InMemoryTelemetryAggregator implements Telemetry, MetricsSnapshotProvider {
  private readonly startedAt = new Date();
  private lastUpdatedAt: Date | null = null;
  private turnsStarted = 0;
  private turnsCompleted = 0;
  private turnsFailed = 0;
  private readonly turnsByStatus: Record<string, number> = {};
  private readonly turnLatency: LatencyAccumulator = createLatencyAccumulator();
  private extractionRequestFailures = 0;
  private structuredOutputFailures = 0;
  private structuredOutputRepairFailures = 0;
  private confirmationsRequested = 0;
  private readonly confirmationDecisions: Record<"yes" | "no" | "ambiguous", number> = {
    yes: 0,
    no: 0,
    ambiguous: 0
  };
  private appCreationSuccess = 0;
  private appCreationFailure = 0;
  private readonly appBuilderLatency: LatencyAccumulator = createLatencyAccumulator();
  private privacyRedactions = 0;
  private readonly redactionsByBoundary: Record<string, number> = {};
  private contentSafetyBlocked = 0;
  private readonly contentSafetyByBoundary: Record<string, number> = {};
  private readonly contentSafetyByCategory: Record<string, number> = {};
  private jailbreakDetected = 0;
  private jailbreakBlocked = 0;
  private jailbreakSanitized = 0;
  private readonly jailbreakByBoundary: Record<string, number> = {};
  private readonly jailbreakByCategory: Record<string, number> = {};

  event(name: string, attributes: TelemetryAttributes = {}): void {
    this.touch();

    if (name === "chat_turn_started") {
      this.turnsStarted += 1;
      return;
    }

    if (name === "chat_turn_completed") {
      this.turnsCompleted += 1;
      incrementRecord(this.turnsByStatus, getStringAttribute(attributes, "status", "unknown"), 1);
      return;
    }

    if (name === "confirmation_requested") {
      this.confirmationsRequested += 1;
    }
  }

  metric(name: string, value: number, attributes: TelemetryAttributes = {}): void {
    this.touch();
    const countValue = toCountValue(value);

    if (name === "chat_turn_failure_count") {
      this.turnsFailed += countValue;
      return;
    }

    if (name === "chat_turn_latency_ms") {
      addLatency(this.turnLatency, value);
      return;
    }

    if (name === "llm_request_failure_count" && getStringAttribute(attributes, "task", "") === "extract_app_spec") {
      this.extractionRequestFailures += countValue;
      return;
    }

    if (name === "llm_structured_output_failure_count" && getStringAttribute(attributes, "task", "") === "extract_app_spec") {
      this.structuredOutputFailures += countValue;
      return;
    }

    if (name === "llm_structured_output_repair_failure_count" && getStringAttribute(attributes, "task", "") === "extract_app_spec") {
      this.structuredOutputRepairFailures += countValue;
      return;
    }

    if (name === "confirmation_decision_count") {
      const decision = getConfirmationDecision(attributes);
      this.confirmationDecisions[decision] += countValue;
      return;
    }

    if (name === "app_creation_success_count") {
      this.appCreationSuccess += countValue;
      return;
    }

    if (name === "app_creation_failure_count") {
      this.appCreationFailure += countValue;
      return;
    }

    if (name === "app_builder_latency_ms") {
      addLatency(this.appBuilderLatency, value);
      return;
    }

    if (name === "sensitive_data_redaction_count") {
      this.privacyRedactions += countValue;
      incrementRecord(this.redactionsByBoundary, getStringAttribute(attributes, "boundary", "unknown"), countValue);
      return;
    }

    if (name === "content_safety_block_count") {
      this.contentSafetyBlocked += countValue;
      incrementRecord(this.contentSafetyByBoundary, getStringAttribute(attributes, "boundary", "unknown"), countValue);
      for (const category of getStringArrayAttribute(attributes, "categories")) {
        incrementRecord(this.contentSafetyByCategory, category, countValue);
      }
      return;
    }

    if (name === "jailbreak_attempt_count") {
      this.jailbreakDetected += countValue;
      if (getStringAttribute(attributes, "outcome", "sanitized") === "blocked") {
        this.jailbreakBlocked += countValue;
      } else {
        this.jailbreakSanitized += countValue;
      }
      incrementRecord(this.jailbreakByBoundary, getStringAttribute(attributes, "boundary", "unknown"), countValue);
      for (const category of getStringArrayAttribute(attributes, "categories")) {
        incrementRecord(this.jailbreakByCategory, category, countValue);
      }
    }
  }

  snapshot(): MetricsSnapshot {
    const extractionFailureTotal = this.extractionRequestFailures + this.structuredOutputFailures + this.structuredOutputRepairFailures;
    const appCreationTotal = this.appCreationSuccess + this.appCreationFailure;
    const totalConfirmationDecisions = Object.values(this.confirmationDecisions).reduce((total, count) => total + count, 0);

    return {
      since: this.startedAt.toISOString(),
      generatedAt: new Date().toISOString(),
      lastUpdatedAt: this.lastUpdatedAt?.toISOString() ?? null,
      turns: {
        started: this.turnsStarted,
        completed: this.turnsCompleted,
        failed: this.turnsFailed,
        byStatus: { ...this.turnsByStatus },
        latencyMs: summarizeLatency(this.turnLatency)
      },
      extractionFailures: {
        requestFailures: this.extractionRequestFailures,
        structuredOutputFailures: this.structuredOutputFailures,
        repairFailures: this.structuredOutputRepairFailures,
        total: extractionFailureTotal
      },
      confirmations: {
        requested: this.confirmationsRequested,
        decisions: { ...this.confirmationDecisions },
        totalDecisions: totalConfirmationDecisions
      },
      appCreation: {
        success: this.appCreationSuccess,
        failure: this.appCreationFailure,
        total: appCreationTotal,
        latencyMs: summarizeLatency(this.appBuilderLatency)
      },
      privacy: {
        redactions: this.privacyRedactions,
        byBoundary: { ...this.redactionsByBoundary }
      },
      contentSafety: {
        blocked: this.contentSafetyBlocked,
        byBoundary: { ...this.contentSafetyByBoundary },
        byCategory: { ...this.contentSafetyByCategory }
      },
      jailbreakResistance: {
        detected: this.jailbreakDetected,
        blocked: this.jailbreakBlocked,
        sanitized: this.jailbreakSanitized,
        byBoundary: { ...this.jailbreakByBoundary },
        byCategory: { ...this.jailbreakByCategory }
      }
    };
  }

  private touch(): void {
    this.lastUpdatedAt = new Date();
  }
}

function createLatencyAccumulator(): LatencyAccumulator {
  return {
    count: 0,
    totalMs: 0,
    maxMs: null,
    lastMs: null
  };
}

function addLatency(accumulator: LatencyAccumulator, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  accumulator.count += 1;
  accumulator.totalMs += value;
  accumulator.lastMs = value;
  accumulator.maxMs = accumulator.maxMs === null ? value : Math.max(accumulator.maxMs, value);
}

function summarizeLatency(accumulator: LatencyAccumulator): LatencyMetricsSnapshot {
  return {
    count: accumulator.count,
    averageMs: accumulator.count === 0 ? null : Math.round(accumulator.totalMs / accumulator.count),
    maxMs: accumulator.maxMs,
    lastMs: accumulator.lastMs
  };
}

function incrementRecord(record: Record<string, number>, key: string, amount: number): void {
  record[key] = (record[key] ?? 0) + amount;
}

function getStringAttribute(attributes: TelemetryAttributes, key: string, fallback: string): string {
  const value = attributes[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getStringArrayAttribute(attributes: TelemetryAttributes, key: string): string[] {
  const value = attributes[key];
  return Array.isArray(value) ? value.filter((item) => item.trim()) : [];
}

function getConfirmationDecision(attributes: TelemetryAttributes): "yes" | "no" | "ambiguous" {
  const decision = getStringAttribute(attributes, "decision", "ambiguous");
  return decision === "yes" || decision === "no" || decision === "ambiguous" ? decision : "ambiguous";
}

function toCountValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}