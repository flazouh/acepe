import {
	CheckpointCreateCommand,
	CommandId,
	type OrchestrationCommand,
	CheckpointReportReadinessCommand
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import {
	type CheckpointRecord,
	type CheckpointServiceError,
	CheckpointService
} from "./Services/CheckpointService.ts"

const asCheckpointInvariant = (commandType: string) => (error: { readonly message: string }) =>
	new OrchestrationCommandInvariantError({
		commandType,
		detail: error.message
	})

const runCheckpoint = <A>(
	commandType: string,
	program: Effect.Effect<A, CheckpointServiceError>
): Effect.Effect<A, OrchestrationCommandInvariantError> =>
	program.pipe(Effect.mapError(asCheckpointInvariant(commandType)))

const fillCreate = Effect.fn("fillCheckpointCreate")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "checkpoint.create" }>
) {
	if (command.modifiedFiles.length === 0) {
		return command
	}
	if (command.projectPath === null) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: command.type,
			detail: "checkpoint.create with files requires projectPath."
		})
	}
	const checkpoints = yield* CheckpointService
	const record = yield* runCheckpoint(
		command.type,
		checkpoints.create({
			checkpointId: command.checkpointId,
			sessionId: command.sessionId,
			projectPath: command.projectPath,
			worktreePath: command.worktreePath,
			modifiedFiles: command.modifiedFiles,
			toolCallId: command.toolCallId,
			name: command.name,
			isAuto: command.isAuto
		})
	)
	return CheckpointCreateCommand.make({
		type: command.type,
		commandId: command.commandId,
		sessionId: command.sessionId,
		checkpointId: command.checkpointId,
		checkpointNumber: record.checkpointNumber,
		name: command.name,
		isAuto: command.isAuto,
		toolCallId: command.toolCallId,
		fileCount: record.fileCount,
		projectPath: command.projectPath,
		worktreePath: command.worktreePath,
		modifiedFiles: command.modifiedFiles
	})
})

const dispatchSafety = Effect.fn("dispatchSafetyCheckpoint")(function*(
	sessionId: Extract<OrchestrationCommand, { readonly type: "checkpoint.revert" }>["sessionId"],
	safety: CheckpointRecord
) {
	const engine = yield* OrchestrationEngine
	yield* engine.dispatch(
		CheckpointCreateCommand.make({
			type: "checkpoint.create",
			commandId: CommandId.make(`${safety.id}-create`),
			sessionId,
			checkpointId: safety.id,
			checkpointNumber: safety.checkpointNumber,
			name: safety.name,
			isAuto: safety.isAuto,
			toolCallId: safety.toolCallId,
			fileCount: safety.fileCount,
			projectPath: null,
			worktreePath: null,
			modifiedFiles: Arr.empty()
		})
	)
	yield* engine.dispatch(
		CheckpointReportReadinessCommand.make({
			type: "checkpoint.report-readiness",
			commandId: CommandId.make(`${safety.id}-readiness`),
			sessionId,
			checkpointId: safety.id,
			status: "ready"
		})
	)
})

const fillRevert = Effect.fn("fillCheckpointRevert")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "checkpoint.revert" }>
) {
	if (command.projectPath === null) {
		return command
	}
	const checkpoints = yield* CheckpointService
	const outcome = yield* runCheckpoint(
		command.type,
		checkpoints.revert({
			sessionId: command.sessionId,
			checkpointId: command.checkpointId,
			projectPath: command.projectPath,
			worktreePath: command.worktreePath
		})
	)
	if (outcome.success === false) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: command.type,
			detail: `Revert aborted for checkpoint '${command.checkpointId}'.`
		})
	}
	if (outcome.safetyCheckpoint !== null) {
		yield* dispatchSafety(command.sessionId, outcome.safetyCheckpoint)
	}
	return command
})

const fillRevertFile = Effect.fn("fillCheckpointRevertFile")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "checkpoint.revert-file" }>
) {
	if (command.projectPath === null) {
		return command
	}
	const checkpoints = yield* CheckpointService
	yield* runCheckpoint(
		command.type,
		checkpoints.revertFile({
			sessionId: command.sessionId,
			checkpointId: command.checkpointId,
			filePath: command.filePath,
			projectPath: command.projectPath,
			worktreePath: command.worktreePath
		})
	)
	return command
})

export const fillCheckpointCommand = Effect.fn("fillCheckpointCommand")(function*(
	command: OrchestrationCommand
) {
	switch (command.type) {
		case "checkpoint.create":
			return yield* fillCreate(command)
		case "checkpoint.revert":
			return yield* fillRevert(command)
		case "checkpoint.revert-file":
			return yield* fillRevertFile(command)
		default:
			return command
	}
})
