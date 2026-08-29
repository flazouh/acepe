import { decodeSessionId, sessionSnapshotRequest } from "@acepe/contracts";
import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { AgentError } from "../../acp/errors/app-error.js";
import { decodeEffect, decodeTrimmed, nextCommandId, withRpcClient } from "./rpc-bridge.ts";

// save/get/delete now ride the orchestration contract: review.file.markReviewed
// and review.session.clear commands (packages/contracts/src/orchestration.ts),
// projected into projection_session_review_state (packages/server/src/
// persistence/Migrations/0020_projection_session_review_state.ts) and read back
// through the session snapshot's `sessionReviewState` field. Signatures are
// unchanged, so SessionReviewStateStore (packages/desktop/src/lib/acp/store/
// session-review-state-store.svelte.ts) needed no changes.
//
// The old Rust-backed facade treated `save` as a whole-document overwrite: one
// JSON blob replaces the session's entire review state every call. The
// per-file command surface has no bulk-replace primitive, so `save` mirrors
// that overwrite semantics itself: dispatch review.session.clear first, then
// review.file.markReviewed for every entry in the incoming blob. This keeps a
// stale revisionKey (a file the store already pruned client-side) from
// lingering in the projection forever, which a diff-based approach would risk
// getting wrong.

const persistedFileReviewProgressSchema = Schema.Struct({
	filePath: Schema.NonEmptyString,
	reviewed: Schema.Boolean,
});

const sessionReviewStateSchema = Schema.Struct({
	version: Schema.Literal(2),
	filesByRevisionKey: Schema.Record(Schema.String, persistedFileReviewProgressSchema),
});

type PersistedSessionReviewState = typeof sessionReviewStateSchema.Type;

const parseJson = fromThrowable(
	(value: string): unknown => JSON.parse(value),
	(error) =>
		error instanceof Error
			? error
			: new Error(`Failed to parse review state JSON: ${String(error)}`)
);

const decodeStateJson = (
	operation: string,
	stateJson: string
): Effect.Effect<PersistedSessionReviewState, AgentError> =>
	parseJson(stateJson).pipe(
		Effect.mapError((error) => new AgentError(operation, error)),
		Effect.flatMap((parsed) => {
			const validation = decodeUnknown(
				sessionReviewStateSchema,
				(error) => new Error(`Invalid review state: ${error.message}`)
			)(parsed);
			if (Result.isSuccess(validation)) {
				return Effect.succeed(validation.success);
			}
			return Effect.fail(new AgentError(operation, validation.failure));
		})
	);

export const sessionReviewState = {
	save: Effect.fn("sessionReviewState.save")(function* (sessionId: string, stateJson: string) {
		const decodedSessionId = yield* decodeEffect(
			"sessionReviewState.save",
			decodeSessionId
		)(sessionId);
		const state = yield* decodeStateJson("sessionReviewState.save", stateJson);

		const clearCommandId = yield* nextCommandId("review-clear");
		yield* withRpcClient("sessionReviewState.save", (client) =>
			client.dispatch({
				type: "review.session.clear",
				commandId: clearCommandId,
				sessionId: decodedSessionId,
			})
		);

		for (const [revisionKey, progress] of Object.entries(state.filesByRevisionKey)) {
			const decodedRevisionKey = yield* decodeTrimmed("sessionReviewState.save", revisionKey);
			const decodedFilePath = yield* decodeTrimmed("sessionReviewState.save", progress.filePath);
			const markCommandId = yield* nextCommandId("review-mark");
			yield* withRpcClient("sessionReviewState.save", (client) =>
				client.dispatch({
					type: "review.file.markReviewed",
					commandId: markCommandId,
					sessionId: decodedSessionId,
					revisionKey: decodedRevisionKey,
					filePath: decodedFilePath,
					reviewed: progress.reviewed,
				})
			);
		}
	}),

	get: Effect.fn("sessionReviewState.get")(function* (sessionId: string) {
		const decodedSessionId = yield* decodeEffect(
			"sessionReviewState.get",
			decodeSessionId
		)(sessionId);
		const snapshot = yield* withRpcClient("sessionReviewState.get", (client) =>
			client.snapshot(sessionSnapshotRequest(decodedSessionId))
		);
		const files = snapshot.sessionReviewState?.files ?? [];
		if (files.length === 0) {
			return null;
		}
		const filesByRevisionKey: Record<string, { filePath: string; reviewed: boolean }> = {};
		for (const file of files) {
			filesByRevisionKey[file.revisionKey] = {
				filePath: file.filePath,
				reviewed: file.reviewed,
			};
		}
		return JSON.stringify({ version: 2, filesByRevisionKey });
	}),

	delete: Effect.fn("sessionReviewState.delete")(function* (sessionId: string) {
		const decodedSessionId = yield* decodeEffect(
			"sessionReviewState.delete",
			decodeSessionId
		)(sessionId);
		const commandId = yield* nextCommandId("review-clear");
		yield* withRpcClient("sessionReviewState.delete", (client) =>
			client.dispatch({
				type: "review.session.clear",
				commandId,
				sessionId: decodedSessionId,
			})
		);
	}),
};
