import {
  createAppRequestSchema,
  createAppResultSchema,
  type AppBuilderClient,
  type CreateAppResult
} from "../appBuilder/appBuilderClient";
import { appSpecSchema } from "../domain/appSpec";
import { assessAppSpecSafety, type ContentSafetyAssessment } from "../domain/contentSafety";
import { assessAppSpecJailbreak, type JailbreakAssessment } from "../domain/jailbreakResistance";
import { getMissingFields } from "../domain/validation";
import { getErrorAttributes, noopTelemetry, type Telemetry } from "../observability/telemetry";
import type { AppCommandRecord, CreateAppCommand } from "./appCommand";
import {
  createPlannedAppCommandRecord,
  markAppCommandExecuting,
  markAppCommandFailed,
  markAppCommandRejected,
  markAppCommandSucceeded
} from "./appCommand";
import type { AppCommandRepository } from "../persistence/appCommandRepository";
import { redactSensitiveValue, type RedactionFinding } from "../privacy/redaction";
import { isRetryableServiceError, type RetryOptions, withRetry } from "../reliability/retry";

export type AppBuilderRetryOptions = Partial<Pick<RetryOptions, "attempts" | "baseDelayMs" | "maxDelayMs" | "shouldRetry" | "sleep">>;

const defaultAppBuilderRetryAttempts = 3;
const defaultAppBuilderRetryBaseDelayMs = 250;
const defaultAppBuilderRetryMaxDelayMs = 2000;

export interface ExecuteCreateAppCommandInput {
  command: CreateAppCommand;
  appBuilder: AppBuilderClient;
  commandRepository?: AppCommandRepository;
  retry?: AppBuilderRetryOptions;
  telemetry?: Telemetry;
}

export interface ExecuteCreateAppCommandResult {
  commandId: string;
  result: CreateAppResult;
  latencyMs: number;
  idempotentReplay: boolean;
}

export async function executeCreateAppCommand(input: ExecuteCreateAppCommandInput): Promise<ExecuteCreateAppCommandResult> {
  const telemetry = input.telemetry ?? noopTelemetry;
  const commandAppSpecRedaction = redactSensitiveValue(input.command.appSpec);
  const command = commandAppSpecRedaction.redacted
    ? { ...input.command, appSpec: commandAppSpecRedaction.value }
    : input.command;
  emitRedactionTelemetry(telemetry, command, "app_command_app_spec", commandAppSpecRedaction.findings);
  const approval = command.approval;
  let commandRecord = await getCommandRecord(command, input.commandRepository);

  if (commandRecord.status === "succeeded" && commandRecord.result) {
    telemetry.event("app_command_idempotent_result_returned", {
      commandId: command.id,
      commandType: command.type,
      idempotencyKey: command.idempotencyKey,
      conversationId: command.conversationId,
      appId: commandRecord.result.appId
    });
    telemetry.metric("app_command_idempotent_replay_count", 1, {
      conversationId: command.conversationId
    });
    return {
      commandId: command.id,
      result: commandRecord.result,
      latencyMs: 0,
      idempotentReplay: true
    };
  }

  if (!approval || approval.status !== "approved") {
    const error = new Error("Cannot execute app creation without human approval.");
    commandRecord = markAppCommandRejected(commandRecord, "missing_human_approval", error);
    await input.commandRepository?.save(commandRecord);
    telemetry.event("app_command_execution_rejected", {
      commandId: command.id,
      commandType: command.type,
      conversationId: command.conversationId,
      riskLevel: command.riskLevel,
      reason: "missing_human_approval"
    });
    throw error;
  }

  const appSpecValidation = appSpecSchema.safeParse(command.appSpec);

  if (!appSpecValidation.success) {
    const error = new Error("Cannot execute app creation with an invalid app spec.");
    commandRecord = markAppCommandRejected(commandRecord, "invalid_app_spec", error);
    await input.commandRepository?.save(commandRecord);
    telemetry.event("app_command_execution_rejected", {
      commandId: command.id,
      commandType: command.type,
      conversationId: command.conversationId,
      riskLevel: command.riskLevel,
      reason: "invalid_app_spec",
      ...getErrorAttributes(appSpecValidation.error)
    });
    throw error;
  }

  const validatedAppSpec = appSpecValidation.data;
  const jailbreak = assessAppSpecJailbreak(validatedAppSpec);

  if (jailbreak.detected) {
    const error = new Error("Cannot execute app creation because the app spec violates jailbreak resistance policy.");
    commandRecord = markAppCommandRejected(commandRecord, "jailbreak_resistance", error);
    await input.commandRepository?.save(commandRecord);
    telemetry.event("app_command_execution_rejected", {
      commandId: command.id,
      commandType: command.type,
      conversationId: command.conversationId,
      riskLevel: command.riskLevel,
      reason: "jailbreak_resistance",
      categories: jailbreak.categories
    });
    emitJailbreakTelemetry(telemetry, command, "app_command", jailbreak);
    throw error;
  }

  const contentSafety = assessAppSpecSafety(validatedAppSpec);

  if (!contentSafety.allowed) {
    const error = new Error("Cannot execute app creation because the app spec violates content safety policy.");
    commandRecord = markAppCommandRejected(commandRecord, "content_safety", error);
    await input.commandRepository?.save(commandRecord);
    telemetry.event("app_command_execution_rejected", {
      commandId: command.id,
      commandType: command.type,
      conversationId: command.conversationId,
      riskLevel: command.riskLevel,
      reason: "content_safety",
      categories: contentSafety.categories
    });
    emitContentSafetyTelemetry(telemetry, command, "app_command", contentSafety);
    throw error;
  }

  const missingFields = getMissingFields(validatedAppSpec);

  if (missingFields.length > 0) {
    const error = new Error(`Cannot execute app creation with missing fields: ${missingFields.join(", ")}`);
    commandRecord = markAppCommandRejected(commandRecord, "missing_fields", error);
    await input.commandRepository?.save(commandRecord);
    telemetry.event("app_command_execution_rejected", {
      commandId: command.id,
      commandType: command.type,
      conversationId: command.conversationId,
      riskLevel: command.riskLevel,
      reason: "missing_fields",
      missingFields
    });
    throw error;
  }

  const lockAcquired = await input.commandRepository?.tryAcquireExecutionLock(command.id) ?? true;
  if (!lockAcquired) {
    telemetry.event("app_command_execution_rejected", {
      commandId: command.id,
      commandType: command.type,
      conversationId: command.conversationId,
      riskLevel: command.riskLevel,
      reason: "already_executing"
    });
    throw new Error("Cannot execute app creation because the command is already executing.");
  }

  try {
    commandRecord = await getCommandRecord(command, input.commandRepository);
    if (commandRecord.status === "succeeded" && commandRecord.result) {
      telemetry.event("app_command_idempotent_result_returned", {
        commandId: command.id,
        commandType: command.type,
        idempotencyKey: command.idempotencyKey,
        conversationId: command.conversationId,
        appId: commandRecord.result.appId
      });
      telemetry.metric("app_command_idempotent_replay_count", 1, {
        conversationId: command.conversationId
      });
      return {
        commandId: command.id,
        result: commandRecord.result,
        latencyMs: 0,
        idempotentReplay: true
      };
    }

    const executionStartedAt = Date.now();
    const result = await withRetry(async () => {
      const attemptStartedAt = Date.now();
      commandRecord = markAppCommandExecuting(commandRecord);
      const attempt = commandRecord.attempts.at(-1);
      await input.commandRepository?.save(commandRecord);
      telemetry.event("app_command_execution_started", {
        commandId: command.id,
        commandType: command.type,
        idempotencyKey: command.idempotencyKey,
        conversationId: command.conversationId,
        userId: command.requestedBy,
        riskLevel: command.riskLevel,
        approvalSource: approval.source,
        approvedBy: approval.approvedBy,
        attemptNumber: attempt?.attemptNumber,
        appType: validatedAppSpec.appType ?? null
      });
      telemetry.event("app_builder_call_started", {
        commandId: command.id,
        idempotencyKey: command.idempotencyKey,
        conversationId: command.conversationId,
        userId: command.requestedBy,
        attemptNumber: attempt?.attemptNumber,
        appType: validatedAppSpec.appType ?? null
      });

      try {
        const appBuilderRequest = createAppRequestSchema.parse({
          idempotencyKey: command.idempotencyKey,
          conversationId: command.conversationId,
          requestedBy: command.requestedBy,
          appSpec: validatedAppSpec
        });
        const parsedAppBuilderResult = createAppResultSchema.parse(await input.appBuilder.createApp(appBuilderRequest));
        const appBuilderResultRedaction = redactSensitiveValue(parsedAppBuilderResult);
        emitRedactionTelemetry(telemetry, command, "app_builder_result", appBuilderResultRedaction.findings);
        const appBuilderResult = appBuilderResultRedaction.value;
        const attemptLatencyMs = Date.now() - attemptStartedAt;
        commandRecord = markAppCommandSucceeded(commandRecord, appBuilderResult, attemptLatencyMs);
        await input.commandRepository?.save(commandRecord);

        telemetry.event("app_builder_call_completed", {
          commandId: command.id,
          idempotencyKey: command.idempotencyKey,
          conversationId: command.conversationId,
          userId: command.requestedBy,
          appId: appBuilderResult.appId,
          attemptNumber: attempt?.attemptNumber,
          latencyMs: attemptLatencyMs
        });

        return appBuilderResult;
      } catch (error) {
        const attemptLatencyMs = Date.now() - attemptStartedAt;
        commandRecord = markAppCommandFailed(commandRecord, error, attemptLatencyMs);
        await input.commandRepository?.save(commandRecord);
        telemetry.event("app_builder_call_failed", {
          commandId: command.id,
          idempotencyKey: command.idempotencyKey,
          conversationId: command.conversationId,
          userId: command.requestedBy,
          attemptNumber: attempt?.attemptNumber,
          latencyMs: attemptLatencyMs,
          ...getErrorAttributes(error)
        });

        throw error;
      }
    }, getRetryOptions(input.retry, telemetry, command));

    const latencyMs = Date.now() - executionStartedAt;

    telemetry.metric("app_creation_success_count", 1, {
      conversationId: command.conversationId
    });
    telemetry.metric("app_builder_latency_ms", latencyMs, {
      conversationId: command.conversationId
    });
    telemetry.event("app_command_execution_completed", {
      commandId: command.id,
      commandType: command.type,
      idempotencyKey: command.idempotencyKey,
      conversationId: command.conversationId,
      appId: result.appId,
      latencyMs,
      attemptCount: commandRecord.attempts.length
    });

    return {
      commandId: command.id,
      result,
      latencyMs,
      idempotentReplay: false
    };
  } catch (error) {
    telemetry.metric("app_creation_failure_count", 1, {
      conversationId: command.conversationId
    });
    telemetry.event("app_command_execution_failed", {
      commandId: command.id,
      commandType: command.type,
      idempotencyKey: command.idempotencyKey,
      conversationId: command.conversationId,
      attemptCount: commandRecord.attempts.length,
      ...getErrorAttributes(error)
    });
    throw error;
  } finally {
    await input.commandRepository?.releaseExecutionLock(command.id);
  }
}

async function getCommandRecord(command: CreateAppCommand, repository: AppCommandRepository | undefined): Promise<AppCommandRecord> {
  const savedRecord = await repository?.get(command.id);
  return savedRecord ? redactSensitiveValue(savedRecord).value : createPlannedAppCommandRecord(command);
}

function emitRedactionTelemetry(
  telemetry: Telemetry,
  command: CreateAppCommand,
  boundary: string,
  findings: RedactionFinding[]
): void {
  if (findings.length === 0) {
    return;
  }

  const redactionCount = findings.reduce((total, finding) => total + finding.count, 0);
  telemetry.event("sensitive_data_redacted", {
    commandId: command.id,
    commandType: command.type,
    conversationId: command.conversationId,
    userId: command.requestedBy,
    boundary,
    findingTypes: findings.map((finding) => finding.type)
  });
  telemetry.metric("sensitive_data_redaction_count", redactionCount, {
    conversationId: command.conversationId,
    boundary
  });
}

function emitContentSafetyTelemetry(
  telemetry: Telemetry,
  command: CreateAppCommand,
  boundary: string,
  assessment: ContentSafetyAssessment
): void {
  telemetry.event("content_safety_blocked", {
    commandId: command.id,
    commandType: command.type,
    conversationId: command.conversationId,
    userId: command.requestedBy,
    boundary,
    categories: assessment.categories,
    reason: assessment.reason
  });
  telemetry.metric("content_safety_block_count", 1, {
    conversationId: command.conversationId,
    boundary,
    categories: assessment.categories
  });
}

function emitJailbreakTelemetry(
  telemetry: Telemetry,
  command: CreateAppCommand,
  boundary: string,
  assessment: Pick<JailbreakAssessment, "categories" | "reason" | "action">
): void {
  const outcome = assessment.action === "block" ? "blocked" : "sanitized";
  telemetry.event("jailbreak_attempt_detected", {
    commandId: command.id,
    commandType: command.type,
    conversationId: command.conversationId,
    userId: command.requestedBy,
    boundary,
    outcome,
    categories: assessment.categories,
    reason: assessment.reason
  });
  telemetry.metric("jailbreak_attempt_count", 1, {
    conversationId: command.conversationId,
    boundary,
    outcome,
    categories: assessment.categories
  });
}

function getRetryOptions(
  retry: AppBuilderRetryOptions | undefined,
  telemetry: Telemetry,
  command: CreateAppCommand
): RetryOptions {
  return {
    attempts: retry?.attempts ?? defaultAppBuilderRetryAttempts,
    baseDelayMs: retry?.baseDelayMs ?? defaultAppBuilderRetryBaseDelayMs,
    maxDelayMs: retry?.maxDelayMs ?? defaultAppBuilderRetryMaxDelayMs,
    shouldRetry: retry?.shouldRetry ?? isRetryableServiceError,
    sleep: retry?.sleep,
    onRetry(error, attempt, delayMs) {
      telemetry.event("app_builder_retry_scheduled", {
        commandId: command.id,
        idempotencyKey: command.idempotencyKey,
        conversationId: command.conversationId,
        attemptNumber: attempt,
        nextAttemptNumber: attempt + 1,
        delayMs,
        ...getErrorAttributes(error)
      });
      telemetry.metric("app_builder_retry_scheduled_count", 1, {
        conversationId: command.conversationId
      });
    }
  };
}