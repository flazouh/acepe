import { SessionId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import { adapterError } from "./Provider.ts"
import { requireSession, type SessionRuntime, takeReplyId } from "./Session.ts"

type CodexSessions = Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>

export type CodexPermissionDecision = "accept" | "acceptForSession" | "decline"

export const mapCodexPermissionReply = (reply: string): Option.Option<CodexPermissionDecision> => {
	if (reply === "once" || reply === "allow") {
		return Option.some("accept")
	}
	if (reply === "always") {
		return Option.some("acceptForSession")
	}
	if (reply === "reject" || reply === "deny") {
		return Option.some("decline")
	}
	return Option.none()
}

export const respondToPermission = Effect.fn("CodexAdapter.respondToPermission")(function*(
	sessions: CodexSessions,
	input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: string
	}
) {
	const runtime = yield* requireSession(sessions, input.sessionId, "respondToPermission")
	const mapped = mapCodexPermissionReply(input.decision)
	if (Option.isNone(mapped)) {
		return yield* adapterError(
			"respondToPermission",
			`Unsupported Codex permission reply: ${input.decision}`
		)
	}
	const replyId = yield* takeReplyId(runtime, input.permissionId)
	yield* runtime.server.reply(replyId, { decision: mapped.value })
})

export const respondToQuestion = Effect.fn("CodexAdapter.respondToQuestion")(function*(
	sessions: CodexSessions,
	input: {
		readonly sessionId: SessionId
		readonly requestId: string
		readonly answers: ReadonlyArray<ReadonlyArray<string>>
	}
) {
	const runtime = yield* requireSession(sessions, input.sessionId, "respondToQuestion")
	const pending = yield* Ref.get(runtime.questionIds)
	const questionIds = HashMap.get(pending, input.requestId)
	if (Option.isNone(questionIds)) {
		return yield* adapterError(
			"respondToQuestion",
			"Codex question ids were not available for the reply"
		)
	}
	if (questionIds.value.length < input.answers.length) {
		return yield* adapterError(
			"respondToQuestion",
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
			adapterError("respondToQuestion", "Codex question reply was not JSON")
		)
	)
	const replyId = yield* takeReplyId(runtime, input.requestId)
	yield* runtime.server.reply(replyId, { answers })
	yield* Ref.update(runtime.questionIds, (current) => HashMap.remove(current, input.requestId))
})
