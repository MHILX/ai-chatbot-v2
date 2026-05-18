import type { AppBuilderClient, CreateAppResult } from "../appBuilder/appBuilderClient";
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
  const approval = input.command.approval;
  let commandRecord = await getCommandRecord(input.command, input.commandRepository);

  if (commandRecord.status === "succeeded" && commandRecord.result) {
    telemetry.event("app_command_idempotent_result_returned", {
      commandId: input.command.id,
      commandType: input.command.type,
      idempotencyKey: input.command.idempotencyKey,
      conversationId: input.command.conversationId,
      appId: commandRecord.result.appId
    });
    telemetry.metric("app_command_idempotent_replay_count", 1, {
      conversationId: input.command.conversationId
    });
    return {
      commandId: input.command.id,
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
      commandId: input.command.id,
      commandType: input.command.type,
      conversationId: input.command.conversationId,
      riskLevel: input.command.riskLevel,
      reason: "missing_human_approval"
    });
    throw error;
  }

  const missingFields = getMissingFields(input.command.appSpec);

  if (missingFields.length > 0) {
    const error = new Error(`Cannot execute app creation with missing fields: ${missingFields.join(", ")}`);
    commandRecord = markAppCommandRejected(commandRecord, "missing_fields", error);
    await input.commandRepository?.save(commandRecord);
    telemetry.event("app_command_execution_rejected", {
      commandId: input.command.id,
      commandType: input.command.type,
      conversationId: input.command.conversationId,
      riskLevel: input.command.riskLevel,
      reason: "missing_fields",
      missingFields
    });
    throw error;
  }

  const lockAcquired = await input.commandRepository?.tryAcquireExecutionLock(input.command.id) ?? true;
  if (!lockAcquired) {
    telemetry.event("app_command_execution_rejected", {
      commandId: input.command.id,
      commandType: input.command.type,
      conversationId: input.command.conversationId,
      riskLevel: input.command.riskLevel,
      reason: "already_executing"
    });
    throw new Error("Cannot execute app creation because the command is already executing.");
  }

  try {
    commandRecord = await getCommandRecord(input.command, input.commandRepository);
    if (commandRecord.status === "succeeded" && commandRecord.result) {
      telemetry.event("app_command_idempotent_result_returned", {
        commandId: input.command.id,
        commandType: input.command.type,
        idempotencyKey: input.command.idempotencyKey,
        conversationId: input.command.conversationId,
        appId: commandRecord.result.appId
      });
      telemetry.metric("app_command_idempotent_replay_count", 1, {
        conversationId: input.command.conversationId
      });
      return {
        commandId: input.command.id,
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
        commandId: input.command.id,
        commandType: input.command.type,
        idempotencyKey: input.command.idempotencyKey,
        conversationId: input.command.conversationId,
        userId: input.command.requestedBy,
        riskLevel: input.command.riskLevel,
        approvalSource: approval.source,
        approvedBy: approval.approvedBy,
        attemptNumber: attempt?.attemptNumber,
        appType: input.command.appSpec.appType ?? null
      });
      telemetry.event("app_builder_call_started", {
        commandId: input.command.id,
        idempotencyKey: input.command.idempotencyKey,
        conversationId: input.command.conversationId,
        userId: input.command.requestedBy,
        attemptNumber: attempt?.attemptNumber,
        appType: input.command.appSpec.appType ?? null
      });

      try {
        const appBuilderResult = await input.appBuilder.createApp({
          idempotencyKey: input.command.idempotencyKey,
          conversationId: input.command.conversationId,
          requestedBy: input.command.requestedBy,
          appSpec: input.command.appSpec
        });
        const attemptLatencyMs = Date.now() - attemptStartedAt;
        commandRecord = markAppCommandSucceeded(commandRecord, appBuilderResult, attemptLatencyMs);
        await input.commandRepository?.save(commandRecord);

        telemetry.event("app_builder_call_completed", {
          commandId: input.command.id,
          idempotencyKey: input.command.idempotencyKey,
          conversationId: input.command.conversationId,
          userId: input.command.requestedBy,
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
          commandId: input.command.id,
          idempotencyKey: input.command.idempotencyKey,
          conversationId: input.command.conversationId,
          userId: input.command.requestedBy,
          attemptNumber: attempt?.attemptNumber,
          latencyMs: attemptLatencyMs,
          ...getErrorAttributes(error)
        });

        throw error;
      }
    }, getRetryOptions(input.retry, telemetry, input.command));

    const latencyMs = Date.now() - executionStartedAt;

    telemetry.metric("app_creation_success_count", 1, {
      conversationId: input.command.conversationId
    });
    telemetry.metric("app_builder_latency_ms", latencyMs, {
      conversationId: input.command.conversationId
    });
    telemetry.event("app_command_execution_completed", {
      commandId: input.command.id,
      commandType: input.command.type,
      idempotencyKey: input.command.idempotencyKey,
      conversationId: input.command.conversationId,
      appId: result.appId,
      latencyMs,
      attemptCount: commandRecord.attempts.length
    });

    return {
      commandId: input.command.id,
      result,
      latencyMs,
      idempotentReplay: false
    };
  } catch (error) {
    telemetry.metric("app_creation_failure_count", 1, {
      conversationId: input.command.conversationId
    });
    telemetry.event("app_command_execution_failed", {
      commandId: input.command.id,
      commandType: input.command.type,
      idempotencyKey: input.command.idempotencyKey,
      conversationId: input.command.conversationId,
      attemptCount: commandRecord.attempts.length,
      ...getErrorAttributes(error)
    });
    throw error;
  } finally {
    await input.commandRepository?.releaseExecutionLock(input.command.id);
  }
}

async function getCommandRecord(command: CreateAppCommand, repository: AppCommandRepository | undefined): Promise<AppCommandRecord> {
  const savedRecord = await repository?.get(command.id);
  return savedRecord ?? createPlannedAppCommandRecord(command);
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