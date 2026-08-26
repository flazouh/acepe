import type { SessionId } from "@acepe/contracts"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import type { JsonObject } from "../Json.ts"
import type { ClaudePermissionDecision } from "./Facts.ts"
import { permissionRequestFact } from "./Map.ts"
import { adapterError } from "./Provider.ts"
import { publishFact, requireSession, type SessionRuntime } from "./Session.ts"
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
			HashMap.values(abandoned),
			(deferred) => Deferred.succeed(deferred, ABANDONED_DECISION),
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
