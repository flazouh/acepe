/**
 * Authoring a scenario in code.
 *
 * Every orchestration event carries eight envelope fields the author does not
 * care about (event id, command id, correlation id, causation, metadata...).
 * The builder owns all of them and keeps them deterministic, so two runs of the
 * same scenario produce byte-identical events and a graded replay can diff.
 *
 * Snapshots are derived with `applyEventToRpcSessionSnapshot`, the same fold the
 * app already trusts. Nothing here re-implements a projection.
 */

import {
	type ActivityId,
	type ApprovalRequestId,
	type MessageId,
	type OrchestrationEvent,
	type ProjectId,
	type RpcProjectedProject,
	type RpcProjectedSession,
	type RpcSessionSnapshot,
	type SessionId,
	type ToolCallId,
	applyEventToRpcSessionSnapshot,
	CommandId,
	emptyRpcSessionSnapshot,
	EventId,
	OrchestrationEvent as OrchestrationEventSchema,
} from "@acepe/contracts"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { QaScenario, QaScenarioStepLine } from "./scenario.ts"

export type ScenarioAuthorOptions = {
	readonly sessionId: SessionId
	readonly projectId: ProjectId
	/** ISO instant the first event happened. Fixed, so replays do not drift. */
	readonly startedAt: string
}

type EnvelopeInput = {
	readonly type: OrchestrationEvent["type"]
	readonly aggregateKind: OrchestrationEvent["aggregateKind"]
	readonly aggregateId: string
}

const decodeOrchestrationEvent = Schema.decodeUnknownSync(OrchestrationEventSchema)

/**
 * A scenario's clock is data, not the machine's clock: `startedAt` plus the
 * step offset. That is what lets two runs produce byte-identical events.
 */
const isoAfter = (startedAt: string, offsetMs: number): string =>
	Option.match(DateTime.make(startedAt), {
		onNone: () => startedAt,
		onSome: (start) => DateTime.formatIso(DateTime.addDuration(start, Duration.millis(offsetMs))),
	})

export class ScenarioBuilder {
	private readonly steps: Array<QaScenarioStepLine> = []
	private readonly options: ScenarioAuthorOptions
	private offsetMs = 0
	private sequence = 0
	private projects: ReadonlyArray<RpcProjectedProject> = []
	private sessions: ReadonlyArray<RpcProjectedSession> = []

	constructor(options: ScenarioAuthorOptions) {
		this.options = options
	}

	/** Move the clock forward. Every event added after this lands at the new offset. */
	advance(ms: number): this {
		this.offsetMs = this.offsetMs + (ms > 0 ? ms : 0)
		return this
	}

	/** Jump the clock to an absolute offset from the scenario start. */
	at(offsetMs: number): this {
		this.offsetMs = offsetMs > this.offsetMs ? offsetMs : this.offsetMs
		return this
	}

	/**
	 * Rows the library snapshot answers with. The canonical session fold does
	 * not populate them, so a scenario that opens the sidebar states them.
	 */
	library(
		projects: ReadonlyArray<RpcProjectedProject>,
		sessions: ReadonlyArray<RpcProjectedSession>,
	): this {
		this.projects = projects
		this.sessions = sessions
		return this
	}

	/**
	 * Decoding through the canonical union is what keeps a hand-authored event
	 * honest: a wrong payload fails here, at author time, instead of producing
	 * an event the real server could never have emitted.
	 */
	private push(envelope: EnvelopeInput, payload: OrchestrationEvent["payload"]): this {
		this.sequence = this.sequence + 1
		const candidate = {
			sequence: this.sequence,
			eventId: EventId.make(`event-${String(this.sequence)}`),
			aggregateKind: envelope.aggregateKind,
			aggregateId: envelope.aggregateId,
			occurredAt: isoAfter(this.options.startedAt, this.offsetMs),
			commandId: CommandId.make(`command-${String(this.sequence)}`),
			causationEventId: null,
			correlationId: CommandId.make(`correlation-${this.options.sessionId}`),
			metadata: {},
			type: envelope.type,
			payload,
		}
		const event = decodeOrchestrationEvent(candidate)
		this.steps.push({ line: "step", offsetMs: this.offsetMs, event })
		return this
	}

	sessionCreated(title: string, providerId?: string): this {
		return this.push(
			{ type: "SessionCreated", aggregateKind: "session", aggregateId: this.options.sessionId },
			providerId === undefined
				? { sessionId: this.options.sessionId, projectId: this.options.projectId, title }
				: {
						sessionId: this.options.sessionId,
						projectId: this.options.projectId,
						title,
						providerId,
					},
		)
	}

	userMessage(messageId: MessageId, text: string): this {
		return this.push(
			{ type: "MessageSent", aggregateKind: "session", aggregateId: this.options.sessionId },
			{ sessionId: this.options.sessionId, messageId, text },
		)
	}

	/** One token per call. Use `tokens` for a whole streamed reply. */
	token(messageId: MessageId, token: string): this {
		return this.push(
			{ type: "TokenAppended", aggregateKind: "session", aggregateId: this.options.sessionId },
			{ sessionId: this.options.sessionId, messageId, token },
		)
	}

	/** A streamed reply. `perTokenMs` is the gap the replay reproduces. */
	tokens(messageId: MessageId, parts: ReadonlyArray<string>, perTokenMs: number): this {
		for (const part of parts) {
			this.advance(perTokenMs).token(messageId, part)
		}
		return this
	}

	toolCall(input: {
		readonly activityId: ActivityId
		readonly toolCallId: ToolCallId
		readonly title: string
		readonly status: "pending" | "in_progress" | "completed" | "failed"
		readonly path?: string
		readonly kind?: string
	}): this {
		return this.push(
			{ type: "ToolCallObserved", aggregateKind: "session", aggregateId: this.options.sessionId },
			{
				sessionId: this.options.sessionId,
				activityId: input.activityId,
				toolCallId: input.toolCallId,
				operationId: null,
				status: input.status,
				title: input.title,
				path: input.path === undefined ? null : input.path,
				kind: input.kind === undefined ? null : input.kind,
			},
		)
	}

	approvalRequested(approvalRequestId: ApprovalRequestId, title: string): this {
		return this.push(
			{
				type: "ApprovalRequested",
				aggregateKind: "session",
				aggregateId: this.options.sessionId,
			},
			{ sessionId: this.options.sessionId, approvalRequestId, title },
		)
	}

	turnCompleted(): this {
		return this.push(
			{ type: "TurnCompleted", aggregateKind: "session", aggregateId: this.options.sessionId },
			{ sessionId: this.options.sessionId },
		)
	}

	build(name: string, description: string): QaScenario {
		const steps: ReadonlyArray<QaScenarioStepLine> = this.steps
		return {
			meta: {
				line: "meta",
				name,
				description,
				capturedAt: null,
				capturedFromSessionId: this.options.sessionId,
			},
			snapshots: [
				{
					line: "snapshot",
					scopeKey: `session:${this.options.sessionId}`,
					snapshot: foldSessionSnapshot(steps),
				},
				{
					line: "snapshot",
					scopeKey: "library",
					snapshot: librarySnapshot(steps, this.projects, this.sessions),
				},
			],
			steps,
			calls: [],
		}
	}
}

/** The canonical fold, run over a scenario's steps. */
export const foldSessionSnapshot = (
	steps: ReadonlyArray<QaScenarioStepLine>,
): RpcSessionSnapshot => {
	let snapshot = emptyRpcSessionSnapshot(0)
	for (const step of steps) {
		snapshot = applyEventToRpcSessionSnapshot(snapshot, step.event)
	}
	return snapshot
}

const librarySnapshot = (
	steps: ReadonlyArray<QaScenarioStepLine>,
	projects: ReadonlyArray<RpcProjectedProject>,
	sessions: ReadonlyArray<RpcProjectedSession>,
): RpcSessionSnapshot => {
	const folded = foldSessionSnapshot(steps)
	const knownSessions: ReadonlyArray<RpcProjectedSession> =
		sessions.length > 0 || folded.session === null ? sessions : [folded.session]
	return {
		snapshotSequence: folded.snapshotSequence,
		session: null,
		messages: [],
		turns: [],
		activities: [],
		pendingApprovals: [],
		checkpoints: [],
		projects,
		sessions: knownSessions,
		settings: [],
		skillsCatalog: null,
		voice: null,
		gitReview: null,
		mcpCatalog: null,
		preconnectionOptions: null,
		terminal: null,
		sessionReviewState: null,
	}
}

export const scenarioBuilder = (options: ScenarioAuthorOptions): ScenarioBuilder =>
	new ScenarioBuilder(options)
