import type { SessionId } from "@acepe/contracts"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import type * as Schema from "effect/Schema"
import { permissionRequestFact } from "./Map.ts"
import { adapterError, type ClaudeCanUseTool, type ClaudePermissionResult } from "./Process.ts"
import { publishFact, requireSession, type SessionRuntime } from "./Session.ts"

type JsonObject = typeof Schema.JsonObject.Type

export type ClaudePermissionDecision = "allow" | "deny"

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

export const makeRespondToPermission = (
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>
) =>
	Effect.fn("ClaudeAdapter.respondToPermission")(function*(input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: ClaudePermissionDecision
	}) {
		const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
		const pending = yield* Ref.get(runtime.pendingPermissions)
		const deferred = HashMap.get(pending, input.permissionId)
		if (Option.isNone(deferred)) {
			return yield* adapterError(
				"sendPrompt",
				`No permission request '${input.permissionId}'.`
			)
		}
		yield* Deferred.succeed(deferred.value, input.decision)
		yield* Ref.update(runtime.pendingPermissions, (current) =>
			HashMap.remove(current, input.permissionId)
		)
	})
