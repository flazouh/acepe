import type { RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { SessionId } from "@acepe/contracts"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import { mapAcpPermissionRequest, selectPermissionOptionId } from "./Map.ts"
import {
	adapterError,
	type CursorPermissionDecision,
	publishFact,
	requireSession,
	type SessionRuntime
} from "./Session.ts"

type Json = typeof Schema.Json.Type

export const cancelledPermission: RequestPermissionResponse = {
	outcome: {
		outcome: "cancelled"
	}
}

export const permissionResponse = (
	request: Json,
	decision: CursorPermissionDecision
): RequestPermissionResponse => {
	const optionId = selectPermissionOptionId(request, decision)
	if (Option.isNone(optionId)) {
		return cancelledPermission
	}
	return {
		outcome: {
			outcome: "selected",
			optionId: optionId.value
		}
	}
}

export const decidePermission = Effect.fn("CursorAdapter.decidePermission")(function*(
	runtimeHolder: Ref.Ref<Option.Option<SessionRuntime>>,
	request: Json
) {
	const held = yield* Ref.get(runtimeHolder)
	if (Option.isNone(held)) {
		return "deny" as const
	}
	const fact = mapAcpPermissionRequest(request)
	if (Option.isNone(fact)) {
		return "deny" as const
	}
	const deferred = yield* Deferred.make<CursorPermissionDecision>()
	yield* Ref.update(held.value.pendingPermissions, (current) =>
		HashMap.set(current, fact.value.id, deferred)
	)
	yield* publishFact(held.value, fact.value)
	return yield* Deferred.await(deferred)
})

export const respondToPermission = Effect.fn("CursorAdapter.respondToPermission")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: CursorPermissionDecision
	}
) {
	const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
	const pending = yield* Ref.get(runtime.pendingPermissions)
	const deferred = HashMap.get(pending, input.permissionId)
	if (Option.isNone(deferred)) {
		return yield* adapterError("sendPrompt", `No permission request '${input.permissionId}'.`)
	}
	yield* Deferred.succeed(deferred.value, input.decision)
	yield* Ref.update(runtime.pendingPermissions, (current) =>
		HashMap.remove(current, input.permissionId)
	)
})
