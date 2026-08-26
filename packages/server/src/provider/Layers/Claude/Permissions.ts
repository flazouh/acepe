import {
	ApprovalRequestId,
	CommandId,
	EventId,
	type SessionId,
	SessionMetaUpdatedEvent
} from "@acepe/contracts"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import {
	type ApprovalDecision,
	pendingApprovalMetadata
} from "../../../persistence/Services/ProjectionPendingApprovals.ts"
import type { JsonObject } from "../Json.ts"
import type { ClaudePermissionDecision } from "./Facts.ts"
import { permissionRequestFact } from "./Map.ts"
import { adapterError } from "./Provider.ts"
import { offerOutbound, publishFact, requireSession, type SessionRuntime } from "./Session.ts"
import type { ClaudeCanUseTool, ClaudePermissionResult } from "./Wire.ts"

// Takes the runtime directly (not an indirection Ref) because by the time
// attachQuery builds this closure the runtime object already exists —
// openSession creates it BEFORE ever attaching a query, unlike the old
// single-query design where canUseTool had to be built before the runtime it
// would eventually belong to.
export const bindCanUseTool = (
	runtime: SessionRuntime,
	decide: (
		runtime: SessionRuntime,
		toolName: string,
		toolInput: JsonObject,
		toolUseID: string
	) => Effect.Effect<ClaudePermissionResult>
): ClaudeCanUseTool =>
	(toolName, toolInput, toolOptions) =>
		Effect.runPromise(decide(runtime, toolName, toolInput, toolOptions.toolUseID))

export const decidePermission = Effect.fn("ClaudeAdapter.decidePermission")(function*(
	runtime: SessionRuntime,
	toolName: string,
	toolInput: JsonObject,
	toolUseID: string
) {
	const deferred = yield* Deferred.make<ClaudePermissionDecision>()
	const fact = permissionRequestFact({
		sessionId: runtime.sessionId,
		toolCallId: toolUseID,
		toolName
	})
	yield* Ref.update(runtime.pendingPermissions, (current) =>
		HashMap.set(current, fact.id, deferred)
	)
	yield* publishFact(runtime, fact)
	const decision = yield* Deferred.await(deferred)
	if (decision === "allow") {
		return {
			behavior: "allow" as const,
			updatedInput: toolInput
		}
	}
	return {
		behavior: "deny" as const,
		message: "User declined tool execution."
	}
})

// The decision an ABANDONED permission gets. Deny, never allow: the tool
// call that asked for it is gone (its query was torn down), so allowing it
// would run a tool nobody is watching for, on an input nobody re-confirmed.
const ABANDONED_DECISION: ClaudePermissionDecision = "deny"

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
// sessionId:openEpochMs:sequence id scheme (see that stamp's own doc for why
// the epoch is in there), so a drained approval's event can never collide
// with a stamped one.
const publishApprovalAnswered = Effect.fn("ClaudeAdapter.publishApprovalAnswered")(function*(
	runtime: SessionRuntime,
	approvalRequestId: string,
	decision: ApprovalDecision
) {
	const sequence = yield* Ref.updateAndGet(runtime.sequence, (current) => current + 1)
	const occurredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
	const commandId = CommandId.make(`${runtime.sessionId}:${runtime.openEpochMs}:cmd:${sequence}`)
	yield* offerOutbound(
		runtime,
		SessionMetaUpdatedEvent.make({
			sequence,
			eventId: EventId.make(`${runtime.sessionId}:${runtime.openEpochMs}:${sequence}`),
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
// SDK's own canUseTool promise is blocked on THAT (see bindCanUseTool),
// running on a detached fiber Effect.runPromise started — so no scope
// closing, no fiber interruption and no query teardown can ever unblock it
// on their own. Left unresolved, the SDK waits forever: the turn never
// ends, the spawned `claude` subprocess stays alive, and the session
// wedges with no error anywhere. Callers today: cancelTurn, shutdown and
// the query listener's own final cleanup (all in Adapter.ts), plus the
// inactivity watchdog (Watchdog.ts).
export const drainPendingPermissions = Effect.fn("ClaudeAdapter.drainPendingPermissions")(
	function*(runtime: SessionRuntime) {
		const abandoned = yield* Ref.getAndSet(
			runtime.pendingPermissions,
			HashMap.empty<string, Deferred.Deferred<ClaudePermissionDecision>>()
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

export const makeRespondToPermission = (
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>
) =>
	Effect.fn("ClaudeAdapter.respondToPermission")(function*(input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: ClaudePermissionDecision
	}) {
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
