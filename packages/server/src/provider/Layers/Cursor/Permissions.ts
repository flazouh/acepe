import type { RequestPermissionResponse } from "@agentclientprotocol/sdk"
import {
	ApprovalRequestId,
	CommandId,
	EventId,
	type SessionId,
	SessionMetaUpdatedEvent
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import {
	type ApprovalDecision,
	pendingApprovalMetadata
} from "../../../persistence/Services/ProjectionPendingApprovals.ts"
import { arrayField, type Json, jsonObjectOf, stringField } from "../Json.ts"
import type { PermissionRequestFact } from "./Facts.ts"
import { mapAcpPermissionRequest } from "./Map.ts"
import { adapterError, type CursorPermissionDecision } from "./Provider.ts"
import { offerOutbound, publishFact, requireSession, type SessionRuntime } from "./Session.ts"

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

// ACP gives the client no id of its own for session/request_permission: the
// params carry the sessionId and the toolCall, and the JSON-RPC id stays
// inside the SDK. So Acepe owns the approval id and derives it from the tool
// call. One tool call may still ask twice — a second permission scope, or a
// retry after a rejection — and a shared id would let the second deferred
// evict the first from pendingPermissions, leaving the first ACP request with
// nothing left to answer it.
const freeApprovalId = (
	pending: HashMap.HashMap<string, Deferred.Deferred<CursorPermissionDecision>>,
	base: string,
	attempt: number
): string => {
	const candidate = attempt === 1 ? base : `${base}#${attempt}`
	if (HashMap.has(pending, candidate)) {
		return freeApprovalId(pending, base, attempt + 1)
	}
	return candidate
}

const withApprovalId = (fact: PermissionRequestFact, id: string): PermissionRequestFact => ({
	contractKind: "permission_request",
	id,
	sessionId: fact.sessionId,
	permission: fact.permission,
	toolCallId: fact.toolCallId
})

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
	// One atomic claim, so two tool calls asking at once cannot pick the same
	// free id off the same read.
	const approvalId = yield* Ref.modify(held.value.pendingPermissions, (current) => {
		const id = freeApprovalId(current, fact.value.id, 1)
		return [id, HashMap.set(current, id, deferred)] as const
	})
	yield* publishFact(held.value, withApprovalId(fact.value, approvalId))
	return yield* Deferred.await(deferred)
})

// The decision an ABANDONED permission gets. Deny, never allow: the tool
// call that asked for it is gone (its ACP connection is about to close), so
// allowing it would run a tool nobody is watching for, on an input nobody
// re-confirmed.
const ABANDONED_DECISION: CursorPermissionDecision = "deny"

// Clears the abandoned approval's row in projection_pending_approvals, with
// the SAME metadata key an answered approval writes — see
// pendingApprovalFactFromEvent in ProjectionPendingApprovals.ts. Resolving
// the deferred alone left that row behind: the operator kept seeing a
// clickable approval for a turn that was over, and clicking it appended a
// spurious ProviderSessionFailed, because respondToPermission finds the
// pending map already empty.
//
// It has to be a SessionMetaUpdated, never an InteractionReplied. Both clear
// the row, but ProviderBridge.considerInteractionReplied reacts to the
// second by calling respondToPermission straight back into that same empty
// map — the exact failure this is meant to remove. SessionMetaUpdated falls
// through the bridge's own switch untouched and still reaches the projector.
//
// The header is minted here rather than through Session.ts's `stamp`, which
// is private to that module: same per-session sequence counter and the same
// id scheme, so a drained approval's event can never collide with a stamped
// one.
const publishApprovalAnswered = Effect.fn("CursorAdapter.publishApprovalAnswered")(function*(
	runtime: SessionRuntime,
	approvalRequestId: string,
	decision: ApprovalDecision
) {
	const sequence = yield* Ref.updateAndGet(runtime.sequence, (current) => current + 1)
	const occurredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
	const commandId = CommandId.make(`${runtime.sessionId}:cmd:${sequence}`)
	yield* offerOutbound(
		runtime,
		SessionMetaUpdatedEvent.make({
			sequence,
			eventId: EventId.make(`${runtime.sessionId}:${sequence}`),
			aggregateKind: "session",
			aggregateId: runtime.sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: pendingApprovalMetadata({
				type: "ApprovalAnswered",
				approvalRequestId: ApprovalRequestId.make(approvalRequestId),
				sessionId: runtime.sessionId,
				decision
			}),
			type: "SessionMetaUpdated",
			payload: {
				sessionId: runtime.sessionId
			}
		})
	)
})

// Resolves every permission this session still has in flight, and empties
// the map. Every path that abandons the tool call behind a pending
// permission MUST call this: decidePermission blocks on a Deferred, and the
// ACP SDK's own session/request_permission handler is blocked on THAT (see
// Process.ts's liveConnect), running inside the SDK's own promise chain —
// so no scope closing, no fiber interruption and no handle teardown can
// ever unblock it on their own. Left unresolved, the agent waits forever:
// the turn never ends, the spawned `cursor-agent` subprocess stays alive,
// and cancelTurn has already dropped the session from `sessions`, so
// respondToPermission can no longer reach the deferred either. Mirrors
// Claude/Permissions.ts's drain of the same name. Callers: cancelTurn and
// shutdown (both in Adapter.ts).
export const drainPendingPermissions = Effect.fn("CursorAdapter.drainPendingPermissions")(
	function*(runtime: SessionRuntime) {
		const abandoned = yield* Ref.getAndSet(
			runtime.pendingPermissions,
			HashMap.empty<string, Deferred.Deferred<CursorPermissionDecision>>()
		)
		yield* Effect.forEach(
			HashMap.toEntries(abandoned),
			(entry) =>
				Deferred.succeed(entry[1], ABANDONED_DECISION).pipe(
					Effect.andThen(publishApprovalAnswered(runtime, entry[0], ABANDONED_DECISION))
				),
			{ discard: true }
		)
	}
)

export const respondToPermission = Effect.fn("CursorAdapter.respondToPermission")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	input: CursorRespondToPermissionInput
) {
	const runtime = yield* requireSession(sessions, input.sessionId, "respondToPermission")
	const pending = yield* Ref.get(runtime.pendingPermissions)
	const deferred = HashMap.get(pending, input.permissionId)
	if (Option.isNone(deferred)) {
		return yield* adapterError(
			"respondToPermission",
			`No permission request '${input.permissionId}'.`
		)
	}
	yield* Deferred.succeed(deferred.value, input.decision)
	yield* Ref.update(runtime.pendingPermissions, (current) =>
		HashMap.remove(current, input.permissionId)
	)
})
