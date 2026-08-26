import { SessionId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import { adapterError } from "./Process.ts"
import { mapCodexPermissionReply } from "./Provider.ts"
import { requireSession, type SessionRuntime } from "./Session.ts"

type CodexSessions = Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>

export const respondToPermission = Effect.fn("CodexAdapter.respondToPermission")(function*(
	sessions: CodexSessions,
	input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: string
	}
) {
	const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
	const mapped = mapCodexPermissionReply(input.decision)
	if (Option.isNone(mapped)) {
		return yield* adapterError(
			"sendPrompt",
			`Unsupported Codex permission reply: ${input.decision}`
		)
	}
	const decodedId = Schema.decodeUnknownExit(Schema.NumberFromString)(input.permissionId)
	if (Exit.isFailure(decodedId)) {
		return yield* adapterError(
			"sendPrompt",
			`Invalid Codex permission request id: ${input.permissionId}`
		)
	}
	yield* runtime.server.reply(decodedId.value, { decision: mapped.value })
})

export const respondToQuestion = Effect.fn("CodexAdapter.respondToQuestion")(function*(
	sessions: CodexSessions,
	input: {
		readonly sessionId: SessionId
		readonly requestId: string
		readonly answers: ReadonlyArray<ReadonlyArray<string>>
	}
) {
	const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
	const pending = yield* Ref.get(runtime.questionIds)
	const questionIds = HashMap.get(pending, input.requestId)
	if (Option.isNone(questionIds)) {
		return yield* adapterError(
			"sendPrompt",
			"Codex question ids were not available for the reply"
		)
	}
	if (questionIds.value.length < input.answers.length) {
		return yield* adapterError(
			"sendPrompt",
			"Codex question reply included more answers than questions"
		)
	}
	const pairs = Arr.zip(questionIds.value, input.answers)
	const answers = yield* Schema.decodeUnknownEffect(Schema.JsonObject)(
		Object.fromEntries(
			Arr.map(pairs, (pair) => [pair[0], { answers: Arr.fromIterable(pair[1]) }])
		)
	).pipe(
		Effect.mapError(() =>
			adapterError("sendPrompt", "Codex question reply was not JSON")
		)
	)
	const decodedId = Schema.decodeUnknownExit(Schema.NumberFromString)(input.requestId)
	if (Exit.isFailure(decodedId)) {
		return yield* adapterError(
			"sendPrompt",
			`Invalid Codex question request id: ${input.requestId}`
		)
	}
	yield* runtime.server.reply(decodedId.value, { answers })
	yield* Ref.update(runtime.questionIds, (current) => HashMap.remove(current, input.requestId))
})
