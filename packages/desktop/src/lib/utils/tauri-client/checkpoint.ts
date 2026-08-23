import {
	CheckpointFileCount,
	type CheckpointId,
	CheckpointNumber,
	decodeCheckpointId,
	decodeSessionId,
	decodeToolCallId,
	type RpcProjectedCheckpoint,
	sessionSnapshotRequest,
} from "@acepe/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AgentError, type AppError } from "../../acp/errors/app-error.js";
import type { Checkpoint, FileSnapshot, RevertResult } from "../../acp/types/index.js";
import type { FileDiffContent } from "../../services/checkpoint-types.js";
import {
	decodeEffect,
	decodeTrimmed,
	nextCommandId,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";

const epochMillisFromIso = (
	operation: string,
	iso: string
): Effect.Effect<number, AgentError> => {
	const made = DateTime.make(iso);
	if (Option.isNone(made)) {
		return Effect.fail(new AgentError(operation, new Error("invalid createdAt")));
	}
	return Effect.succeed(DateTime.toEpochMillis(made.value));
};

const mapCheckpoint = (
	row: RpcProjectedCheckpoint
): Effect.Effect<Checkpoint, AgentError> =>
	epochMillisFromIso("checkpoint.map", row.createdAt).pipe(
		Effect.map((createdAt) => ({
			id: row.checkpointId,
			sessionId: row.sessionId,
			checkpointNumber: row.checkpointNumber,
			name: row.name,
			createdAt,
			toolCallId: row.toolCallId,
			isAuto: row.isAuto,
			fileCount: row.fileCount,
			totalLinesAdded: null,
			totalLinesRemoved: null,
		}))
	);

const nextCheckpointNumber = (rows: readonly RpcProjectedCheckpoint[]): number => {
	let maxNumber = 0;
	for (const row of rows) {
		if (row.checkpointNumber > maxNumber) {
			maxNumber = row.checkpointNumber;
		}
	}
	return maxNumber + 1;
};

const loadSessionCheckpoints = Effect.fn("loadSessionCheckpoints")(function* (
	sessionId: string
) {
	const decodedSessionId = yield* decodeEffect("checkpoint.snapshot", decodeSessionId)(
		sessionId
	);
	const snapshot = yield* withRpcClient("checkpoint.snapshot", (client) =>
		client.snapshot(sessionSnapshotRequest(decodedSessionId))
	);
	return { decodedSessionId, snapshot };
});

const findMappedCheckpoint = (
	rows: readonly RpcProjectedCheckpoint[],
	checkpointId: CheckpointId
): Effect.Effect<Checkpoint, AgentError> => {
	for (const row of rows) {
		if (row.checkpointId === checkpointId) {
			return mapCheckpoint(row);
		}
	}
	return Effect.fail(
		new AgentError("checkpoint.create", new Error("created checkpoint missing from snapshot"))
	);
};

export const checkpoint = {
	create: Effect.fn("checkpoint.create")(function* (
		sessionId: string,
		projectPath: string,
		modifiedFiles: string[],
		options?: {
			toolCallId?: string;
			name?: string;
			isAuto?: boolean;
			worktreePath?: string;
			agentId?: string;
		}
	) {
		const loaded = yield* loadSessionCheckpoints(sessionId);
		const createCommandId = yield* nextCommandId("checkpoint-create");
		const checkpointId = yield* decodeEffect("checkpoint.create", decodeCheckpointId)(
			`checkpoint-${String(createCommandId)}`
		);
		const checkpointNumber = yield* decodeEffect(
			"checkpoint.create",
			Schema.decodeUnknownEffect(CheckpointNumber)
		)(nextCheckpointNumber(loaded.snapshot.checkpoints));
		const fileCount = yield* decodeEffect(
			"checkpoint.create",
			Schema.decodeUnknownEffect(CheckpointFileCount)
		)(modifiedFiles.length);
		const name =
			options?.name === undefined
				? null
				: yield* decodeTrimmed("checkpoint.create", options.name);
		const toolCallId =
			options?.toolCallId === undefined
				? null
				: yield* decodeEffect("checkpoint.create", decodeToolCallId)(options.toolCallId);
		yield* withRpcClient("checkpoint.create", (client) =>
			client.dispatch({
				type: "checkpoint.create",
				commandId: createCommandId,
				sessionId: loaded.decodedSessionId,
				checkpointId,
				checkpointNumber,
				name,
				isAuto: options?.isAuto ?? true,
				toolCallId,
				fileCount,
				projectPath,
				worktreePath: options?.worktreePath ?? null,
				modifiedFiles,
			})
		);
		const readinessCommandId = yield* nextCommandId("checkpoint-ready");
		yield* withRpcClient("checkpoint.report-readiness", (client) =>
			client.dispatch({
				type: "checkpoint.report-readiness",
				commandId: readinessCommandId,
				sessionId: loaded.decodedSessionId,
				checkpointId,
				status: "ready",
			})
		);
		const after = yield* withRpcClient("checkpoint.snapshot", (client) =>
			client.snapshot(sessionSnapshotRequest(loaded.decodedSessionId))
		);
		return yield* findMappedCheckpoint(after.checkpoints, checkpointId);
	}),

	list: Effect.fn("checkpoint.list")(function* (sessionId: string) {
		const loaded = yield* loadSessionCheckpoints(sessionId);
		const mapped: Checkpoint[] = [];
		for (const row of loaded.snapshot.checkpoints) {
			mapped.push(yield* mapCheckpoint(row));
		}
		return mapped;
	}),

	getFileContent: (
		_sessionId: string,
		_checkpointId: string,
		_filePath: string
	): Effect.Effect<string, AppError> => unsupportedOnContract("checkpoint.getFileContent"),

	getFileDiffContent: (
		_sessionId: string,
		_checkpointId: string,
		_filePath: string
	): Effect.Effect<FileDiffContent, AppError> =>
		unsupportedOnContract("checkpoint.getFileDiffContent"),

	revert: Effect.fn("checkpoint.revert")(function* (
		sessionId: string,
		checkpointId: string,
		projectPath: string,
		worktreePath?: string
	) {
		const decodedSessionId = yield* decodeEffect("checkpoint.revert", decodeSessionId)(
			sessionId
		);
		const decodedCheckpointId = yield* decodeEffect("checkpoint.revert", decodeCheckpointId)(
			checkpointId
		);
		const commandId = yield* nextCommandId("checkpoint-revert");
		yield* withRpcClient("checkpoint.revert", (client) =>
			client.dispatch({
				type: "checkpoint.revert",
				commandId,
				sessionId: decodedSessionId,
				checkpointId: decodedCheckpointId,
				projectPath,
				worktreePath: worktreePath ?? null,
			})
		);
		const result: RevertResult = {
			success: true,
			revertedFiles: [],
			failedFiles: [],
		};
		return result;
	}),

	revertFile: (
		_sessionId: string,
		_checkpointId: string,
		_filePath: string,
		_projectPath: string,
		_worktreePath?: string
	): Effect.Effect<void, AppError> => unsupportedOnContract("checkpoint.revertFile"),

	getFileSnapshots: (
		_sessionId: string,
		_checkpointId: string
	): Effect.Effect<FileSnapshot[], AppError> =>
		unsupportedOnContract("checkpoint.getFileSnapshots"),
};
