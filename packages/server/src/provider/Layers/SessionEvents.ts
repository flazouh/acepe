import {
	ActivityId,
	ApprovalRequestedEvent,
	ApprovalRequestId,
	type CommandId,
	type EventId,
	type ObservedToolStatus,
	type SessionId,
	ToolCallId,
	ToolCallObservedEvent
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { EMPTY_JSON_OBJECT } from "./Json.ts"

// The per-event identity a provider's own `stamp` mints, and the only part of
// stamping that differs between providers: Claude derives its ids from
// sessionId:openEpochMs:sequence (see Claude/Session.ts's stamp for the
// restart collision that forced the epoch in), everyone else from
// sessionId:sequence. So the stamp stays in the provider folder and only its
// result crosses into the builders below.
export type SessionEventHeader = {
	readonly sequence: number
	readonly eventId: EventId
	readonly occurredAt: string
	readonly commandId: CommandId
}

// What a "tool_call" fact recorded about a tool call, kept around so a LATER
// "tool_call_update" fact (which may carry only a toolCallId and a status)
// can still publish a complete ToolCallObservedEvent: the projector's
// ToolCallObservedPayload requires a title on every row, not just the first
// one — see ProjectionSessionActivities.ts's observedToolRow.
export type OpenToolCallInfo = {
	readonly activityId: ActivityId
	readonly title: string
	readonly path: string | null
}

// Keyed by the provider's own tool call id.
export type OpenToolCalls = Ref.Ref<HashMap.HashMap<string, OpenToolCallInfo>>

// One projection_session_activities row per provider tool call, keyed the
// same way across its whole lifecycle (start -> completed/failed) so the
// projector's merge sees one growing row instead of two unrelated ones. Every
// provider's own tool call id is already unique per call, so deriving the
// activityId from it is enough — no separate id needs to round-trip through
// the provider boundary.
export const toolCallActivityId = (toolCallId: string): ActivityId =>
	ActivityId.make(`${toolCallId}:activity`)

// A tool_call_update fact that arrives with no cached start info, e.g. the
// start was missed across a resume boundary, or a tool-result part landed
// with no preceding tool part. Falls back to a generic, still-nonempty title
// rather than dropping the status transition on the floor; mergeActivityRow
// on the projector side keeps this only until a better title arrives for the
// same activityId.
export const FALLBACK_TOOL_TITLE = "Tool"

// completed and failed are the two ObservedToolStatus values no further
// update can follow, so they are the point at which the cache below may
// forget a call.
const isSettled = (status: ObservedToolStatus): boolean =>
	status === "completed" || status === "failed"

// Records what a later update will need, and forgets the call instead when it
// arrives already settled — nothing follows a terminal status, so caching one
// would grow openToolCalls for the session's whole life.
export const rememberOpenToolCall = (
	openToolCalls: OpenToolCalls,
	toolCallId: string,
	status: ObservedToolStatus,
	info: OpenToolCallInfo
) =>
	isSettled(status)
		? Ref.update(openToolCalls, (current) => HashMap.remove(current, toolCallId))
		: Ref.update(openToolCalls, (current) => HashMap.set(current, toolCallId, info))

// Reads the start info an update needs, and drops the entry once the status
// is terminal: the same bound on openToolCalls from the other side.
export const takeOpenToolCall = Effect.fn("SessionEvents.takeOpenToolCall")(function*(
	openToolCalls: OpenToolCalls,
	toolCallId: string,
	status: ObservedToolStatus
) {
	const cache = yield* Ref.get(openToolCalls)
	if (isSettled(status)) {
		yield* Ref.update(openToolCalls, (current) => HashMap.remove(current, toolCallId))
	}
	return Option.getOrElse(
		HashMap.get(cache, toolCallId),
		(): OpenToolCallInfo => ({
			activityId: toolCallActivityId(toolCallId),
			title: FALLBACK_TOOL_TITLE,
			path: null
		})
	)
})

export type ToolCallObservedInput = {
	readonly activityId: ActivityId
	readonly toolCallId: string
	readonly status: ObservedToolStatus
	readonly title: string
	readonly path: string | null
}

// Builds the SAME contract event the tracer's ToolCallObserveCommand decider
// produces (see acpDecide.ts's "tool.call.observe" case):
// ProjectionSessionActivities.ts only knows how to turn a ToolCallObserved
// event into a projection_session_activities row, so a real tool call folded
// into a generic SessionMetaUpdated is invisible to that projector no matter
// what its encoded metadata says.
export const toolCallObservedEvent = (
	header: SessionEventHeader,
	sessionId: SessionId,
	input: ToolCallObservedInput
): ToolCallObservedEvent =>
	ToolCallObservedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "ToolCallObserved",
		payload: {
			sessionId,
			activityId: input.activityId,
			toolCallId: ToolCallId.make(input.toolCallId),
			operationId: null,
			status: input.status,
			title: input.title,
			path: input.path
		}
	})

export type ApprovalRequestedInput = {
	readonly approvalRequestId: string
	readonly title: string
}

// #268 defect 2: a real permission prompt used to fold into the generic
// SessionMetaUpdated branch, whose metadata nobody reads for approvals.
// ProjectionPendingApprovals.apply only reacts to a native
// ApprovalRequested/InteractionReplied event or an explicitly stamped
// pendingApproval metadata key (see pendingApprovalFactFromEvent), neither of
// which an encoded fact ever produced, so projection_pending_approvals never
// learned about the prompt and the desktop panel had nothing to render: the
// turn hung on an approval no one could see or answer. Same carve-out as
// toolCallObservedEvent above — a real, typed event instead of an opaque
// metadata blob.
export const approvalRequestedEvent = (
	header: SessionEventHeader,
	sessionId: SessionId,
	input: ApprovalRequestedInput
): ApprovalRequestedEvent =>
	ApprovalRequestedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "ApprovalRequested",
		payload: {
			sessionId,
			approvalRequestId: ApprovalRequestId.make(input.approvalRequestId),
			title: input.title
		}
	})
