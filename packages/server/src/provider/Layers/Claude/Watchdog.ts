import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import type { ProviderAdapterError } from "../../Services/ProviderAdapter.ts"
import { drainPendingPermissions } from "./Permissions.ts"
import { teardownQuery } from "./Process.ts"
import { publishFact, type SessionRuntime } from "./Session.ts"

// Recovers a session whose turn appears wedged: no provider stream
// activity for turnInactivityTimeout while a turn is open. Synthesizes a
// turn_error fact (the SAME contract shape a real SDK error already maps
// to — see Facts.ts's TurnErrorFact — so this needs no new event
// type) to close the stuck turn in the projection, then tears down and
// re-attaches the query so the NEXT sendPrompt works. Forked once per
// session, for the session's whole lifetime, into sessionScope — so it is
// interrupted automatically whenever the session's outer stream ends,
// same as the query listener.
export const makeWatchdogLoop = (
	watchdogPollInterval: Duration.Input,
	turnInactivityTimeout: Duration.Input,
	permissionWaitTimeout: Duration.Input,
	cancelInterruptTimeout: Duration.Input,
	attachQuery: (
		runtime: SessionRuntime,
		resume: Option.Option<string>,
		myGeneration: number
	) => Effect.Effect<void, ProviderAdapterError>
) =>
	Effect.fn("ClaudeAdapter.watchdogLoop")(function*(runtime: SessionRuntime) {
		while (true) {
			yield* Effect.sleep(watchdogPollInterval)
			const turnOpenedAt = yield* Ref.get(runtime.turnOpenedAtMs)
			if (Option.isNone(turnOpenedAt)) {
				continue
			}
			const lastActivity = yield* Ref.get(runtime.lastActivityAtMs)
			const now = yield* Clock.currentTimeMillis
			const idleMs = now - lastActivity
			// A turn blocked on a permission is not stalled — the SDK is
			// doing exactly what it should, waiting on a human, and a human
			// takes far longer than turnInactivityTimeout. Judging that wait
			// by the stall bound auto-denies the approval the operator is
			// still looking at and tears the query down under them. It still
			// gets a bound, just a much larger one, so an approval nobody
			// ever answers cannot pin the `claude` subprocess open forever.
			const waiting = yield* Ref.get(runtime.pendingPermissions)
			const blockedOnPermission = HashMap.size(waiting) > 0
			const timeout = blockedOnPermission ? permissionWaitTimeout : turnInactivityTimeout
			if (idleMs < Duration.toMillis(timeout)) {
				continue
			}
			yield* Ref.set(runtime.turnOpenedAtMs, Option.none())
			yield* publishFact(runtime, {
				contractKind: "turn_error",
				detail: blockedOnPermission
					? `A permission request went unanswered for ${Math.round(idleMs / 1000)}s; ` +
						"the turn was recovered by the inactivity watchdog and the request was denied."
					: `No provider activity for ${Math.round(idleMs / 1000)}s while a turn was open; ` +
						"the turn was recovered by the inactivity watchdog."
			})
			const state = yield* Ref.get(runtime.streamState)
			const nextGeneration = yield* Ref.updateAndGet(runtime.generation, (current) => current + 1)
			const oldQuery = yield* Ref.get(runtime.queryRef)
			// A stall can be a stall ON a permission: the SDK is blocked on
			// canUseTool, nothing streams, and the recovery below throws away
			// the query that asked. Drained before teardownQuery because that
			// pending canUseTool is exactly what wedges the SDK's own
			// interrupt(), then again after it for the permission the SDK can
			// still raise while interrupt() is in flight. Both are ahead of
			// attachQuery, so a permission belonging to the NEW query can
			// never be caught by either. See drainPendingPermissions.
			yield* drainPendingPermissions(runtime)
			yield* teardownQuery(oldQuery, cancelInterruptTimeout)
			yield* drainPendingPermissions(runtime)
			yield* attachQuery(runtime, state.providerSessionId, nextGeneration)
		}
	})
