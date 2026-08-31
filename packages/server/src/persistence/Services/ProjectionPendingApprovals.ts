import {
	type ApprovalAnsweredFact,
	type ApprovalRequestedFact,
	ApprovalRequestId,
	type OrchestrationEvent,
	PENDING_APPROVAL_METADATA_KEY,
	PendingApprovalFact,
	Sequence,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_PENDING_APPROVALS_NAME = "projection.pending-approvals"

export const ProjectedPendingApproval = Schema.Struct({
	approvalRequestId: ApprovalRequestId,
	sessionId: SessionId,
	sequence: Sequence
})
export type ProjectedPendingApproval = typeof ProjectedPendingApproval.Type

const ProjectionPendingApprovalRow = Schema.Struct({
	approval_request_id: ApprovalRequestId,
	session_id: SessionId,
	sequence: Sequence
})

export interface ProjectionPendingApprovalsShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly listBySession: (
		sessionId: SessionId
	) => Effect.Effect<ReadonlyArray<ProjectedPendingApproval>, SqlError | Schema.SchemaError>
	readonly get: (
		approvalRequestId: ApprovalRequestId
	) => Effect.Effect<Option.Option<ProjectedPendingApproval>, SqlError | Schema.SchemaError>
}

export class ProjectionPendingApprovals extends Context.Service<
	ProjectionPendingApprovals,
	ProjectionPendingApprovalsShape
>()("@acepe/server/persistence/Services/ProjectionPendingApprovals") {}

const projectedPendingApprovalFromRow = (
	row: typeof ProjectionPendingApprovalRow.Type
): ProjectedPendingApproval => ({
	approvalRequestId: row.approval_request_id,
	sessionId: row.session_id,
	sequence: row.sequence
})

const decodeRow = Schema.decodeUnknownEffect(ProjectionPendingApprovalRow)
const decodeFact = Schema.decodeUnknownEffect(PendingApprovalFact)

export const decodeStoredProjectedPendingApproval = Effect.fn(
	"decodeStoredProjectedPendingApproval"
)(function*(input: unknown) {
	const row = yield* decodeRow(input)
	return projectedPendingApprovalFromRow(row)
})

const hasApprovalRequestId = (
	rows: ReadonlyArray<ProjectedPendingApproval>,
	approvalRequestId: ApprovalRequestId
): boolean => Option.isSome(Arr.findFirst(rows, (row) => row.approvalRequestId === approvalRequestId))

const sessionOf = (rows: ReadonlyArray<ProjectedPendingApproval>): Option.Option<SessionId> =>
	Option.map(Arr.head(rows), (row) => row.sessionId)

const forThisSession = (
	rows: ReadonlyArray<ProjectedPendingApproval>,
	sessionId: SessionId
): boolean =>
	Option.match(sessionOf(rows), {
		onNone: () => true,
		onSome: (currentSessionId) => currentSessionId === sessionId
	})

const pendingApprovalFactFromEvent = Effect.fn("pendingApprovalFactFromEvent")(function*(
	event: OrchestrationEvent
) {
	if (event.type === "ApprovalRequested") {
		return Option.some({
			type: "ApprovalRequested" as const,
			approvalRequestId: event.payload.approvalRequestId,
			sessionId: event.payload.sessionId
		})
	}
	if (event.type === "InteractionReplied") {
		return Option.some({
			type: "ApprovalAnswered" as const,
			approvalRequestId: event.payload.approvalRequestId,
			sessionId: event.payload.sessionId,
			decision: event.payload.decision
		})
	}
	const value = event.metadata[PENDING_APPROVAL_METADATA_KEY]
	if (value === undefined) {
		return Option.none()
	}
	const fact = yield* decodeFact(value)
	return Option.some(fact)
})

const factAppliesToCurrent = (
	current: ReadonlyArray<ProjectedPendingApproval>,
	event: OrchestrationEvent,
	factSessionId: SessionId
): boolean => {
	if (event.aggregateKind !== "session") {
		return false
	}
	if (event.aggregateId !== factSessionId) {
		return false
	}
	return forThisSession(current, factSessionId)
}

const projectRequested = (
	current: ReadonlyArray<ProjectedPendingApproval>,
	event: OrchestrationEvent,
	fact: ApprovalRequestedFact
): ReadonlyArray<ProjectedPendingApproval> => {
	if (factAppliesToCurrent(current, event, fact.sessionId) === false) {
		return current
	}
	if (hasApprovalRequestId(current, fact.approvalRequestId)) {
		return current
	}
	return Arr.append(current, {
		approvalRequestId: fact.approvalRequestId,
		sessionId: fact.sessionId,
		sequence: event.sequence
	})
}

const projectAnswered = (
	current: ReadonlyArray<ProjectedPendingApproval>,
	event: OrchestrationEvent,
	fact: ApprovalAnsweredFact
): ReadonlyArray<ProjectedPendingApproval> => {
	if (factAppliesToCurrent(current, event, fact.sessionId) === false) {
		return current
	}
	if (hasApprovalRequestId(current, fact.approvalRequestId) === false) {
		return current
	}
	return Arr.filter(current, (row) => row.approvalRequestId !== fact.approvalRequestId)
}

// SessionDeleted is terminal, so its outstanding approvals can never be
// answered and must not survive as orphan rows. SessionArchived stays a
// no-op on purpose: an archived session can be unarchived, and this fold
// consumes each event once, so rows dropped on archive could never come
// back on unarchive.
const projectSessionDeleted = (
	current: ReadonlyArray<ProjectedPendingApproval>,
	event: OrchestrationEvent,
	deletedSessionId: SessionId
): ReadonlyArray<ProjectedPendingApproval> => {
	if (factAppliesToCurrent(current, event, deletedSessionId) === false) {
		return current
	}
	const next = Arr.filter(current, (row) => row.sessionId !== deletedSessionId)
	return next.length === current.length ? current : next
}

export const evolveProjectedPendingApprovals = (
	current: ReadonlyArray<ProjectedPendingApproval>,
	event: OrchestrationEvent
): Effect.Effect<ReadonlyArray<ProjectedPendingApproval>, Schema.SchemaError> => {
	if (event.type === "SessionDeleted") {
		return Effect.succeed(projectSessionDeleted(current, event, event.payload.sessionId))
	}
	return pendingApprovalFactFromEvent(event).pipe(
		Effect.map((fact) =>
			Option.match(fact, {
				onNone: () => current,
				onSome: (value) =>
					Match.value(value).pipe(
						Match.discriminatorsExhaustive("type")({
							ApprovalRequested: (requested) => projectRequested(current, event, requested),
							ApprovalAnswered: (answered) => projectAnswered(current, event, answered)
						})
					)
			})
		)
	)
}
