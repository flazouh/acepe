import type { SessionId } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Ref from "effect/Ref"
import type { OpenCodePermissionReply } from "./Facts.ts"
import { isSafeRequestId } from "./Map.ts"
import { adapterError } from "./Provider.ts"
import { requireSession, type SessionRuntime } from "./Session.ts"

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
			"sendPrompt",
			`Request ID '${input.permissionId}' contains invalid characters (only alphanumeric, '-', '_' allowed)`
		)
	}
	const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
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
			"sendPrompt",
			`Request ID '${input.questionId}' contains invalid characters (only alphanumeric, '-', '_' allowed)`
		)
	}
	const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
	yield* runtime.transport.replyQuestion(input.questionId, input.answers)
})
