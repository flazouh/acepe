import type { RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { SessionId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { arrayField, type Json, jsonObjectOf, stringField } from "../Json.ts"
import { mapAcpPermissionRequest } from "./Map.ts"
import { adapterError, type CursorPermissionDecision } from "./Provider.ts"
import { publishFact, requireSession, type SessionRuntime } from "./Session.ts"

export type CursorRespondToPermissionInput = {
	readonly sessionId: SessionId
	readonly permissionId: string
	readonly decision: CursorPermissionDecision
}

export const cancelledPermission: RequestPermissionResponse = {
	outcome: {
		outcome: "cancelled"
	}
}

const optionKindAllows = (kind: string, decision: CursorPermissionDecision): boolean => {
	if (decision === "allow") {
		return kind === "allow_once" || kind === "allow_always"
	}
	return kind === "reject_once" || kind === "reject_always"
}

const optionIdIfKind = (
	entry: Json,
	decision: CursorPermissionDecision
): Option.Option<string> => {
	const record = jsonObjectOf(entry)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const kind = stringField(record.value, "kind")
	const optionId = stringField(record.value, "optionId")
	if (Option.isNone(kind) || Option.isNone(optionId)) {
		return Option.none()
	}
	if (optionKindAllows(kind.value, decision) === false) {
		return Option.none()
	}
	return Option.some(optionId.value)
}

export const selectPermissionOptionId = (
	request: Json,
	decision: CursorPermissionDecision
): Option.Option<string> => {
	const record = jsonObjectOf(request)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const options = arrayField(record.value, "options")
	if (Option.isNone(options)) {
		return Option.none()
	}
	return Arr.head(
		Arr.filterMap(
			options.value,
			Filter.fromPredicateOption((entry) => optionIdIfKind(entry, decision))
		)
	)
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
	input: CursorRespondToPermissionInput
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
