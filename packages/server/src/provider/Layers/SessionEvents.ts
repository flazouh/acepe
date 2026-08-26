import {
	ActivityId,
	type ApprovalDecision,
	ApprovalRequestedEvent,
	ApprovalRequestId,
	type CommandId,
	type EventId,
	type ObservedToolStatus,
	type SessionId,
	SessionMetaUpdatedEvent,
	ToolCallId,
	ToolCallObservedEvent,
	observedToolKind,
	observedToolOutput,
	pendingApprovalMetadata
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
	// The provider's tool classification, cached so a later tool_call_update
	// (which may carry only a toolCallId and a status) still publishes a
	// ToolCallObserved event that names the kind. The start event always
	// classifies the call; the projector keeps the first non-null kind, so
	// this only ever confirms what the start already recorded.
	readonly kind: string | null
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
// rather than dropping the status transition on the floor.
//
// This title is permanent once it lands. The four copies this replaced all
// claimed mergeActivityRow would swap in a better title later, but that
// merge only replaces a title equal to STUB_ACTIVITY_TITLE ("activity") --
// see ProjectionSessionActivities.ts's isStubTitle -- and "Tool" is not that
// sentinel. So a row that starts on the fallback keeps it even when the real
// title arrives afterwards. Left as found: the fix belongs in the projector's
// stub vocabulary, not in a provider's fallback string.
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
			path: null,
			kind: null
		})
	)
})

// output is the tool's result, and only a settling update carries one: a
// start event passes null, and so does a provider whose own facts do not
// carry a result yet (Claude and Cursor today -- see their
// publishToolCallUpdated). It stays out of OpenToolCallInfo above on
// purpose: nothing arrives before the output that would need it cached.
export type ToolCallObservedInput = {
	readonly activityId: ActivityId
	readonly toolCallId: string
	readonly status: ObservedToolStatus
	readonly title: string
	readonly path: string | null
	readonly output: string | null
	// The provider's tool classification. Optional so a provider that has
	// not been widened to pass one still compiles; it then travels as null,
	// exactly like a call the provider genuinely could not classify.
	readonly kind?: string | null
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
			path: input.path,
			// observedToolOutput is what makes a blank provider output an
			// absent one and bounds an enormous one. ToolCallObservedEvent.make
			// throws rather than failing on a value TrimmedNonEmptyString
			// rejects, which would kill the calling adapter's fiber.
			output: observedToolOutput(input.output),
			// observedToolKind applies the same blank -> null / trim guard to
			// the provider's classification. Absent (undefined) collapses to
			// null the same way a provider that never classified the call does.
			kind: observedToolKind(input.kind ?? null)
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

export type ApprovalAnsweredInput = {
	readonly approvalRequestId: string
	readonly decision: ApprovalDecision
}

// Clears an approval's row in projection_pending_approvals, with the same
// metadata key an answered approval writes — see pendingApprovalMetadata in
// @acepe/contracts and pendingApprovalFactFromEvent in
// ProjectionPendingApprovals.ts. Resolving a drained permission's deferred
// alone left that row behind: the operator kept seeing a clickable approval
// for a turn that was over, and clicking it appended a spurious
// ProviderSessionFailed, because respondToPermission finds the pending map
// already empty.
//
// It has to be a SessionMetaUpdated, never an InteractionReplied. Both clear
// the row, but ProviderBridge.considerInteractionReplied reacts to the second
// by calling respondToPermission straight back into that same empty map — the
// exact failure this is meant to remove. SessionMetaUpdated falls through the
// bridge's own switch untouched and still reaches the projector.
//
// This is the one exception to the carve-out approvalRequestedEvent above
// documents: an ANSWER has no typed event a provider adapter may mint of its
// own, precisely because the typed one (InteractionReplied) is a command the
// bridge answers back on.
export const approvalAnsweredEvent = (
	header: SessionEventHeader,
	sessionId: SessionId,
	input: ApprovalAnsweredInput
): SessionMetaUpdatedEvent =>
	SessionMetaUpdatedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: pendingApprovalMetadata({
			type: "ApprovalAnswered",
			approvalRequestId: ApprovalRequestId.make(input.approvalRequestId),
			sessionId,
			decision: input.decision
		}),
		type: "SessionMetaUpdated",
		payload: {
			sessionId
		}
	})
