import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { CheckpointId, SessionId } from "@acepe/contracts"
import {
	CheckpointEmptyError,
	CheckpointNotFoundError,
	CheckpointPathError,
	CheckpointService,
	CheckpointSessionMismatchError
} from "./CheckpointService.ts"

Vitest.describe("CheckpointService", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			CheckpointService.key,
			"@acepe/server/checkpoint/Services/CheckpointService"
		)
	})
})

Vitest.describe("CheckpointService errors", () => {
	Vitest.it.effect("CheckpointEmptyError names the session", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new CheckpointEmptyError({ sessionId: SessionId.make("session-1") })
			)
			Vitest.assert.strictEqual(error._tag, "CheckpointEmptyError")
			Vitest.assert.isTrue(Schema.is(CheckpointEmptyError)(error))
			Vitest.assert.strictEqual(
				error.message,
				"No files could be read for a checkpoint in session 'session-1'."
			)
		})
	)

	Vitest.it.effect("CheckpointNotFoundError names the checkpoint", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new CheckpointNotFoundError({ checkpointId: CheckpointId.make("checkpoint-1") })
			)
			Vitest.assert.strictEqual(error._tag, "CheckpointNotFoundError")
			Vitest.assert.strictEqual(error.message, "Checkpoint not found: checkpoint-1")
		})
	)

	Vitest.it.effect("CheckpointPathError keeps the rust reason text", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new CheckpointPathError({
					path: "../etc/passwd",
					reason: "Path contains invalid traversal pattern: ../etc/passwd"
				})
			)
			Vitest.assert.strictEqual(error._tag, "CheckpointPathError")
			Vitest.assert.strictEqual(
				error.message,
				"Path contains invalid traversal pattern: ../etc/passwd"
			)
		})
	)

	Vitest.it.effect("CheckpointSessionMismatchError denies cross-session access", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new CheckpointSessionMismatchError({
					checkpointId: CheckpointId.make("checkpoint-1"),
					sessionId: SessionId.make("session-1")
				})
			)
			Vitest.assert.strictEqual(
				error.message,
				"Access denied: checkpoint belongs to a different session"
			)
		})
	)
})
