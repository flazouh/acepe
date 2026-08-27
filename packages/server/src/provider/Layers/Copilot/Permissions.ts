import type { SessionId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { arrayField, type Json, jsonObjectOf, stringField } from "../Json.ts"
import { adapterError, type CopilotPermissionDecision } from "./Provider.ts"
import {
	type PendingPermission,
	publishApprovalAnswered,
	requireSession,
	type SessionRuntime
} from "./Session.ts"

export type CopilotRespondToPermissionInput = {
	readonly sessionId: SessionId
	readonly permissionId: string
	readonly decision: CopilotPermissionDecision
}

const CANCELLED_OUTCOME: Json = {
	outcome: {
		outcome: "cancelled"
	}
}

const optionKindAllows = (kind: string, decision: CopilotPermissionDecision): boolean => {
	if (decision === "allow") {
		return kind === "allow_once" || kind === "allow_always"
	}
	return kind === "reject_once" || kind === "reject_always"
}

const optionIdIfKind = (
	entry: Json,
	decision: CopilotPermissionDecision
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
	decision: CopilotPermissionDecision
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

// A request that offered no option matching the decision gets "cancelled",
// which ACP defines as the agent abandoning the tool call. Denying by
// inventing an optionId the agent never offered would be rejected as an
// unknown option and leave the turn hanging instead.
export const permissionResponse = (
	request: Json,
	decision: CopilotPermissionDecision
): Json => {
	const optionId = selectPermissionOptionId(request, decision)
	if (Option.isNone(optionId)) {
		return CANCELLED_OUTCOME
	}
	return {
		outcome: {
			outcome: "selected",
			optionId: optionId.value
		}
	}
}

export const respondToPermission = Effect.fn("CopilotAdapter.respondToPermission")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	input: CopilotRespondToPermissionInput
) {
	const runtime = yield* requireSession(sessions, input.sessionId, "respondToPermission")
	// The read and the removal are ONE Ref.modify step, so two answers racing
	// the same approval cannot both reply to a request the agent answers once.
	const entry = yield* Ref.modify(runtime.pendingPermissions, (current) =>
		[
			HashMap.get(current, input.permissionId),
			HashMap.remove(current, input.permissionId)
		] as const)
	if (Option.isNone(entry)) {
		return yield* adapterError(
			"respondToPermission",
			`No permission request '${input.permissionId}'.`
		)
	}
	yield* runtime.transport.reply(
		entry.value.replyId,
		permissionResponse(entry.value.request, input.decision)
	)
	yield* publishApprovalAnswered(runtime, input.permissionId, input.decision)
})

// Answers every permission this session still has in flight, and empties the
// map. Every path that abandons the tool call behind a pending permission
// MUST call this: the agent blocks on the reply, so an unanswered request
// keeps the turn and the spawned CLI alive forever. Mirrors
// Cursor/Permissions.ts's drain of the same name.
//
// Answering is only half of it. Each abandoned approval also publishes its
// own answer, or its row in projection_pending_approvals outlives the turn
// and the operator keeps seeing a clickable approval nothing can answer.
//
// Deny, never allow: the tool call that asked is gone, so allowing it would
// run a tool nobody is watching for, on an input nobody re-confirmed.
const ABANDONED_DECISION: CopilotPermissionDecision = "deny"

export const drainPendingPermissions = Effect.fn("CopilotAdapter.drainPendingPermissions")(
	function*(runtime: SessionRuntime) {
		const abandoned = yield* Ref.getAndSet(
			runtime.pendingPermissions,
			HashMap.empty<string, PendingPermission>()
		)
		yield* Effect.forEach(
			HashMap.toEntries(abandoned),
			(entry) =>
				runtime.transport
					.reply(entry[1].replyId, CANCELLED_OUTCOME)
					.pipe(
						Effect.ignore,
						Effect.andThen(publishApprovalAnswered(runtime, entry[0], ABANDONED_DECISION))
					),
			{ discard: true }
		)
	}
)
