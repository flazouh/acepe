import type { SessionId } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Ref from "effect/Ref"
import type { OpenCodePermissionReply } from "./Facts.ts"
import { adapterError } from "./Provider.ts"
import { requireSession, type SessionRuntime } from "./Session.ts"
import { isSafeRequestId } from "./Wire.ts"

export const respondToPermission = Effect.fn("OpenCodeAdapter.respondToPermission")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly reply: OpenCodePermissionReply
	}
) {
	if (isSafeRequestId(input.permissionId) === false) {
		return yield* adapterError(
			"respondToPermission",
			`Request ID '${input.permissionId}' contains invalid characters (only alphanumeric, '-', '_' allowed)`
		)
	}
	const runtime = yield* requireSession(sessions, input.sessionId, "respondToPermission")
	yield* runtime.transport.replyPermission(input.permissionId, input.reply)
})

export const respondToQuestion = Effect.fn("OpenCodeAdapter.respondToQuestion")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	input: {
		readonly sessionId: SessionId
		readonly questionId: string
		readonly answers: ReadonlyArray<ReadonlyArray<string>>
	}
) {
	if (isSafeRequestId(input.questionId) === false) {
		return yield* adapterError(
			"respondToQuestion",
			`Request ID '${input.questionId}' contains invalid characters (only alphanumeric, '-', '_' allowed)`
		)
	}
	const runtime = yield* requireSession(sessions, input.sessionId, "respondToQuestion")
	yield* runtime.transport.replyQuestion(input.questionId, input.answers)
})
