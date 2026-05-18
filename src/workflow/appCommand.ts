import type { AppSpec } from "../domain/appSpec";
import type { ConversationState } from "../domain/conversationState";
import { getMissingFields } from "../domain/validation";
import type { CreateAppResult } from "../appBuilder/appBuilderClient";
import { createHash } from "node:crypto";

export type AppCommandRiskLevel = "high";
export type HumanApprovalSource = "explicit_user_confirmation";

export interface HumanApproval {
  status: "approved";
  approvedBy: string | null;
  approvedAt: string;
  source: HumanApprovalSource;
}

export interface CreateAppCommand {
  id: string;
  type: "create_app";
  idempotencyKey: string;
  conversationId: string;
  requestedBy: string | null;
  appSpec: AppSpec;
  riskLevel: AppCommandRiskLevel;
  approvalRequired: true;
  approval?: HumanApproval;
  plannedAt: string;
}

export type AppCommand = CreateAppCommand;

export type AppCommandStatus = "planned" | "executing" | "succeeded" | "failed" | "rejected";
export type AppCommandAttemptStatus = "executing" | "succeeded" | "failed" | "rejected";

export interface AppCommandError {
  errorName: string;
  errorMessage: string;
}

export interface AppCommandExecutionAttempt {
  attemptNumber: number;
  status: AppCommandAttemptStatus;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  error?: AppCommandError;
}

export interface AppCommandToolOutput {
  toolName: "app_builder";
  status: "succeeded" | "failed" | "rejected";
  recordedAt: string;
  latencyMs?: number;
  output?: CreateAppResult;
  error?: AppCommandError;
  rejectionReason?: string;
}

export interface AppCommandRecord {
  command: AppCommand;
  status: AppCommandStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  attempts: AppCommandExecutionAttempt[];
  toolOutputs: AppCommandToolOutput[];
  result?: CreateAppResult;
  error?: AppCommandError;
  rejectionReason?: string;
}

export function planCreateAppCommand(state: ConversationState): CreateAppCommand {
  if (state.status !== "creating_app") {
    throw new Error(`Cannot plan app creation while conversation status is ${state.status}.`);
  }

  if (!state.confirmed) {
    throw new Error("Cannot plan app creation before explicit confirmation.");
  }

  if (!state.readyToBuild) {
    throw new Error("Cannot plan app creation before requirements are ready.");
  }

  const missingFields = getMissingFields(state.appSpec);
  if (missingFields.length > 0) {
    throw new Error(`Cannot plan app creation with missing fields: ${missingFields.join(", ")}`);
  }

  const plannedAt = new Date().toISOString();

  const commandId = buildCreateAppCommandId(state.conversationId, state.appSpec);

  return {
    id: commandId,
    type: "create_app",
    idempotencyKey: commandId,
    conversationId: state.conversationId,
    requestedBy: state.userId ?? null,
    appSpec: structuredClone(state.appSpec),
    riskLevel: "high",
    approvalRequired: true,
    approval: {
      status: "approved",
      approvedBy: state.userId ?? null,
      approvedAt: plannedAt,
      source: "explicit_user_confirmation"
    },
    plannedAt
  };
}

function buildCreateAppCommandId(conversationId: string, appSpec: AppSpec): string {
  return `create_app:${conversationId}:${getAppSpecFingerprint(appSpec)}`;
}

function getAppSpecFingerprint(appSpec: AppSpec): string {
  return createHash("sha256").update(JSON.stringify(appSpec)).digest("hex").slice(0, 16);
}

export function createPlannedAppCommandRecord(command: AppCommand): AppCommandRecord {
  return {
    command: structuredClone(command),
    status: "planned",
    createdAt: command.plannedAt,
    updatedAt: command.plannedAt,
    attempts: [],
    toolOutputs: []
  };
}

export function markAppCommandExecuting(record: AppCommandRecord, startedAt = new Date().toISOString()): AppCommandRecord {
  const next = structuredClone(record);
  const attemptNumber = next.attempts.length + 1;

  next.status = "executing";
  next.updatedAt = startedAt;
  delete next.completedAt;
  delete next.result;
  delete next.error;
  delete next.rejectionReason;
  next.attempts.push({
    attemptNumber,
    status: "executing",
    startedAt
  });

  return next;
}

export function markAppCommandSucceeded(
  record: AppCommandRecord,
  result: CreateAppResult,
  latencyMs: number,
  completedAt = new Date().toISOString()
): AppCommandRecord {
  const next = structuredClone(record);
  const currentAttempt = next.attempts.at(-1);

  next.status = "succeeded";
  next.updatedAt = completedAt;
  next.completedAt = completedAt;
  next.result = structuredClone(result);
  delete next.error;
  delete next.rejectionReason;

  if (currentAttempt) {
    currentAttempt.status = "succeeded";
    currentAttempt.completedAt = completedAt;
    currentAttempt.latencyMs = latencyMs;
  }

  next.toolOutputs.push({
    toolName: "app_builder",
    status: "succeeded",
    recordedAt: completedAt,
    latencyMs,
    output: structuredClone(result)
  });

  return next;
}

export function markAppCommandFailed(
  record: AppCommandRecord,
  error: unknown,
  latencyMs: number,
  completedAt = new Date().toISOString()
): AppCommandRecord {
  const next = structuredClone(record);
  const commandError = getAppCommandError(error);
  const currentAttempt = next.attempts.at(-1);

  next.status = "failed";
  next.updatedAt = completedAt;
  next.completedAt = completedAt;
  next.error = commandError;
  delete next.result;
  delete next.rejectionReason;

  if (currentAttempt) {
    currentAttempt.status = "failed";
    currentAttempt.completedAt = completedAt;
    currentAttempt.latencyMs = latencyMs;
    currentAttempt.error = commandError;
  }

  next.toolOutputs.push({
    toolName: "app_builder",
    status: "failed",
    recordedAt: completedAt,
    latencyMs,
    error: commandError
  });

  return next;
}

export function markAppCommandRejected(
  record: AppCommandRecord,
  rejectionReason: string,
  error: unknown,
  rejectedAt = new Date().toISOString()
): AppCommandRecord {
  const next = structuredClone(record);
  const commandError = getAppCommandError(error);

  next.status = "rejected";
  next.updatedAt = rejectedAt;
  next.completedAt = rejectedAt;
  next.error = commandError;
  next.rejectionReason = rejectionReason;
  delete next.result;

  next.attempts.push({
    attemptNumber: next.attempts.length + 1,
    status: "rejected",
    startedAt: rejectedAt,
    completedAt: rejectedAt,
    error: commandError
  });
  next.toolOutputs.push({
    toolName: "app_builder",
    status: "rejected",
    recordedAt: rejectedAt,
    error: commandError,
    rejectionReason
  });

  return next;
}

function getAppCommandError(error: unknown): AppCommandError {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message
    };
  }

  return {
    errorName: "UnknownError",
    errorMessage: String(error)
  };
}