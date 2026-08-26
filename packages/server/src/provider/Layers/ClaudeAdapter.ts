import { query, type McpServerConfig, type Options as ClaudeSdkOptions } from "@anthropic-ai/claude-agent-sdk"
import {
	ActivityId,
	ApprovalRequestedEvent,
	ApprovalRequestId,
	CommandId,
	EventId,
	MessageId,
	MessageSentEvent,
	type ObservedToolStatus,
	type OrchestrationEvent,
	SessionId,
	SessionMetaUpdatedEvent,
	TokenAppendedEvent,
	ToolCallId,
	ToolCallObservedEvent,
	TurnCancelledEvent,
	TurnCompletedEvent,
	TurnId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as Clock from "effect/Clock"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import {
	ProviderAdapterError,
	type ProviderAdapter,
	type ProviderPresence,
	type CancelTurnRequest,
	type SendPromptRequest,
	type StartSessionRequest
} from "../Services/ProviderAdapter.ts"
import {
	CLAUDE_CAPABILITIES,
	CLAUDE_ISOLATED_SETTING_SOURCES,
	CLAUDE_PROVIDER_ID,
	CLAUDE_SESSION_MCP_SERVERS,
	CLAUDE_STRICT_MCP_CONFIG,
	probeClaudePresence,
	resolveClaudeExecutablePath
} from "./ClaudeProvider.ts"
import {
	type ClaudeContractFact,
	type ClaudeStreamState,
	deferredOpenFact,
	emptyClaudeStreamState,
	encodeContractFact,
	mapSdkMessage,
	permissionRequestFact,
	toolCallPathHint
} from "./ClaudeSdkMap.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const EMPTY_JSON_OBJECT: JsonObject = {}

export type ClaudePermissionDecision = "allow" | "deny"

export type ClaudePermissionResult =
	| {
			readonly behavior: "allow"
			readonly updatedInput: JsonObject
	  }
	| {
			readonly behavior: "deny"
			readonly message: string
	  }

export type ClaudeCanUseTool = (
	toolName: string,
	input: JsonObject,
	options: { readonly toolUseID: string }
) => Promise<ClaudePermissionResult>

export type ClaudeUserPrompt = {
	readonly type: "user"
	readonly session_id: string
	readonly parent_tool_use_id: null
	readonly message: {
		readonly role: "user"
		readonly content: string
	}
}

export type ClaudeQueryInput = {
	readonly prompt: AsyncIterable<ClaudeUserPrompt>
	readonly cwd: string
	readonly canUseTool: ClaudeCanUseTool
	// The Claude SDK's OWN session id to resume, when recovering a query
	// after a cancel or a watchdog-detected stall — see attachQuery. Absent
	// (None) for a session's very first query, or when no provider session id
	// has been observed yet (the stall happened before the SDK's own init
	// message ever arrived).
	readonly resume: Option.Option<string>
}

export type ClaudeQueryHandle = {
	readonly messages: Stream.Stream<Json, ProviderAdapterError>
	readonly interrupt: Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

export type ClaudeAdapter = ProviderAdapter & {
	readonly respondToPermission: (input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: ClaudePermissionDecision
	}) => Effect.Effect<void, ProviderAdapterError>
	// Forcefully tears down every live session's query (SIGTERM-then-SIGKILL-
	// equivalent — see makeClaudeAdapter's shutdown). ProviderBridge calls
	// this structurally, the same way it calls respondToPermission, on every
	// registered adapter that exposes it when the bridge's own scope closes.
	readonly shutdown: Effect.Effect<void>
}

export type ClaudeAdapterOptions = {
	readonly createQuery: (
		input: ClaudeQueryInput
	) => Effect.Effect<ClaudeQueryHandle, ProviderAdapterError>
	readonly presence: Effect.Effect<ProviderPresence>
	// Bounds cancelTurn's call to the SDK's own interrupt(): a hung interrupt
	// promise must never block ProviderBridge's single shared dispatcher fiber
	// forever (that wedges EVERY session in the app, not just this one — see
	// the module doc above cancelTurn). Defaults to 5s.
	readonly cancelInterruptTimeout?: Duration.Input
	// A turn counts as wedged once this much time passes with no stream
	// activity while it's open (a prompt was sent, no turn_complete/turn_error
	// yet). Defaults to 60s — generous enough for a real tool-using turn's
	// natural gaps, short enough to recover a genuinely stalled session
	// without the operator noticing a multi-minute hang.
	readonly turnInactivityTimeout?: Duration.Input
	// How often the watchdog checks for a stalled turn. Defaults to 5s.
	readonly watchdogPollInterval?: Duration.Input
}

const DEFAULT_CANCEL_INTERRUPT_TIMEOUT = Duration.seconds(5)
const DEFAULT_TURN_INACTIVITY_TIMEOUT = Duration.seconds(60)
const DEFAULT_WATCHDOG_POLL_INTERVAL = Duration.seconds(5)

// What a "tool_call" fact recorded about a tool call, kept around so the
// LATER "tool_call_update" fact (which carries only toolCallId + a new
// status -- see ToolCallUpdateFact in ClaudeSdkMap.ts) can still publish a
// complete ToolCallObservedEvent: the projector's ToolCallObservedPayload
// requires a title on every row, not just the first one -- see
// ProjectionSessionActivities.ts's observedToolRow.
type OpenToolCallInfo = {
	readonly activityId: ActivityId
	readonly title: string
	readonly path: string | null
}

// One projection_session_activities row per Claude tool_use block, keyed the
// same way across its whole lifecycle (start -> completed/failed) so the
// projector's merge sees one growing row instead of two unrelated ones. The
// SDK's own toolCallId is already unique per call, so deriving activityId
// from it (rather than minting a fresh one) is enough -- no separate id
// needs to round-trip through the SDK boundary.
const toolCallActivityId = (toolCallId: string): ActivityId => ActivityId.make(`${toolCallId}:activity`)

type SessionRuntime = {
	readonly sessionId: SessionId
	readonly workspaceRoot: string
	// Epoch-ms captured ONCE when openSession builds this runtime -- see
	// stamp()'s use of it below for why. Deliberately NOT reset by attachQuery
	// (cancel/watchdog recovery reuse the SAME runtime and its sequence
	// counter keeps incrementing correctly); it only differs across a genuine
	// process restart, which is exactly the case that matters.
	readonly openEpochMs: number
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly streamState: Ref.Ref<ClaudeStreamState>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly pendingPermissions: Ref.Ref<
		HashMap.HashMap<string, Deferred.Deferred<ClaudePermissionDecision>>
	>
	// Keyed by the SDK's own toolCallId. See OpenToolCallInfo's doc above.
	readonly openToolCalls: Ref.Ref<HashMap.HashMap<string, OpenToolCallInfo>>
	// The query a sendPrompt call feeds and a stream listener drains. Both are
	// swapped together by attachQuery whenever a session recovers from a
	// cancel or a watchdog-detected stall, so sendPrompt/cancelTurn always
	// read the CURRENT one rather than a query that may already be dead.
	readonly promptQueueRef: Ref.Ref<Queue.Queue<ClaudeUserPrompt, Done>>
	readonly queryRef: Ref.Ref<ClaudeQueryHandle>
	// Bumped by every attachQuery call. A query-listener fiber compares its
	// OWN captured generation against this at teardown time: a mismatch means
	// a newer query has since been attached (a deliberate restart, not a real
	// death), so the listener must skip the "session is gone" cleanup — see
	// attachQuery.
	readonly generation: Ref.Ref<number>
	// Epoch-ms when the CURRENTLY open turn started (sendPrompt), or None
	// when no turn is open — the watchdog only ever acts while a turn is
	// open. Cleared by publishFact on turn_complete/turn_error (including the
	// watchdog's own synthesized one) and by cancelTurn.
	readonly turnOpenedAtMs: Ref.Ref<Option.Option<number>>
	// Epoch-ms of the most recent provider stream activity — reset on every
	// raw SDK message AND whenever a prompt is sent, so the watchdog measures
	// silence, not merely "time since the turn opened".
	readonly lastActivityAtMs: Ref.Ref<number>
	// Set by cancelTurn once it has torn the query down; sendPrompt checks
	// this before offering into promptQueueRef and, if set, attaches a fresh
	// query FIRST. cancelTurn itself deliberately does NOT reattach eagerly —
	// a cancel with no follow-up (the user walked away, or a caller like a
	// test only cancelling for cleanup) would otherwise spawn a real `claude`
	// subprocess nobody asked for, exactly the kind of unconditional respawn
	// Defect D's fix already ruled out at the ProviderBridge level. The
	// watchdog, in contrast, DOES reattach eagerly (see watchdogLoop) — a
	// wedged turn always needs the session usable again immediately, there is
	// no "maybe nobody needs it" case for a stall the operator never asked
	// for.
	readonly needsReattach: Ref.Ref<boolean>
	// An explicit, non-fiber-structural scope that owns every query-listener
	// and the watchdog fiber for this session's whole lifetime, independent
	// of which caller's fiber happens to invoke attachQuery (openSession's
	// own fiber for the first attach, but ProviderBridge's shared dispatcher
	// fiber for a cancel-triggered restart, or the watchdog's own fiber for a
	// stall-triggered one) — see openSession and attachQuery.
	readonly sessionScope: Scope.Closeable
}

const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: CLAUDE_PROVIDER_ID,
		operation,
		detail
	})

const errorDetail = <A>(cause: A, fallback: string): string => {
	if (Predicate.isError(cause) && Str.isNonEmpty(cause.message)) {
		return cause.message
	}
	return fallback
}

const jsonObjectFromValue = <A>(value: A): JsonObject => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return exit.value
	}
	return EMPTY_JSON_OBJECT
}

const userPrompt = (text: string, providerSessionId: Option.Option<string>): ClaudeUserPrompt => ({
	type: "user",
	session_id: Option.getOrElse(providerSessionId, () => ""),
	parent_tool_use_id: null,
	message: {
		role: "user",
		content: text
	}
})

const assistantMessageId = (
	sessionId: SessionId,
	lastUser: Option.Option<MessageId>
): MessageId =>
	Option.match(lastUser, {
		onNone: () => MessageId.make(`${sessionId}:assistant`),
		onSome: tracerAssistantMessageId
	})

const nextSequence = (runtime: SessionRuntime) =>
	Ref.updateAndGet(runtime.sequence, (current) => current + 1)

// eventId/commandId are stamped as sessionId:openEpochMs:sequence, NOT bare
// sessionId:sequence -- DEFECT D (reproduced live): a session lazily reopened
// after a real app restart gets a BRAND NEW SessionRuntime whose `sequence`
// Ref starts over at 0 (see openSession below), so a bare sessionId:sequence
// scheme re-derives the SAME eventIds the PRIOR process already committed
// for that session's real conversation history, and the store's
// UNIQUE(event_id) constraint rejects the append -- surfacing as
// ProviderSessionFailed and leaving the session's ClaudeAdapter-side runtime
// registered but un-forwarded, i.e. silently poisoned: every later
// sendPrompt on it just hangs (MessageSent commits, nothing else ever does).
// openEpochMs is real wall-clock time captured once when the runtime is
// built, so a genuine restart (which takes measurable time) can never
// collide with the epoch a prior process used for the same session, while a
// cancel/watchdog recovery (attachQuery reusing the SAME runtime, sequence
// still incrementing) is unaffected -- it never changes epoch mid-runtime.
const stamp = Effect.fn("ClaudeAdapter.stamp")(function*(runtime: SessionRuntime) {
	const sequence = yield* nextSequence(runtime)
	const occurredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
	const commandId = CommandId.make(`${runtime.sessionId}:${runtime.openEpochMs}:cmd:${sequence}`)
	return {
		sequence,
		eventId: EventId.make(`${runtime.sessionId}:${runtime.openEpochMs}:${sequence}`),
		occurredAt,
		commandId
	}
})

const offerOutbound = (runtime: SessionRuntime, event: OrchestrationEvent) =>
	Queue.offer(runtime.outbound, event).pipe(Effect.asVoid)

const makeTokenEvent = Effect.fn("ClaudeAdapter.makeTokenEvent")(function*(
	runtime: SessionRuntime,
	token: string
) {
	const header = yield* stamp(runtime)
	const lastUser = yield* Ref.get(runtime.lastUserMessageId)
	return TokenAppendedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "TokenAppended",
		payload: {
			sessionId: runtime.sessionId,
			messageId: assistantMessageId(runtime.sessionId, lastUser),
			token
		}
	})
})

const makeMetaEvent = Effect.fn("ClaudeAdapter.makeMetaEvent")(function*(
	runtime: SessionRuntime,
	fact: ClaudeContractFact
) {
	const header = yield* stamp(runtime)
	const metadata = Option.getOrElse(encodeContractFact(fact), () => EMPTY_JSON_OBJECT)
	return SessionMetaUpdatedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata,
		type: "SessionMetaUpdated",
		payload: {
			sessionId: runtime.sessionId
		}
	})
})

const makeMessageSent = Effect.fn("ClaudeAdapter.makeMessageSent")(function*(
	runtime: SessionRuntime,
	request: SendPromptRequest
) {
	const header = yield* stamp(runtime)
	return MessageSentEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "MessageSent",
		payload: {
			sessionId: runtime.sessionId,
			messageId: request.messageId,
			text: request.text
		}
	})
})

const makeCancelled = Effect.fn("ClaudeAdapter.makeCancelled")(function*(runtime: SessionRuntime) {
	const header = yield* stamp(runtime)
	return TurnCancelledEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "TurnCancelled",
		payload: {
			sessionId: runtime.sessionId
		}
	})
})

// The SDK's own turn-end signal is its `result` message, which
// ClaudeSdkMap.mapSdkMessage already turns into a turn_complete (or
// turn_error) fact. That fact is the ONLY thing that closes an open
// projection_turns row absent a follow-up TurnCancelled or the next
// MessageSent starting a new turn — see ProjectionTurns.ts's
// evolveProjectedTurns. turn_error still closes the turn (rather than
// leaving it "running" forever): projection_turns has no separate "failed"
// status yet, so an errored turn is recorded as completed. Distinguishing
// success from failure in the projection is a follow-up, not something this
// fix invents room for.
const makeCompleted = Effect.fn("ClaudeAdapter.makeCompleted")(function*(runtime: SessionRuntime) {
	const header = yield* stamp(runtime)
	const lastUser = yield* Ref.get(runtime.lastUserMessageId)
	return TurnCompletedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "TurnCompleted",
		payload: Option.match(lastUser, {
			onNone: () => ({ sessionId: runtime.sessionId }),
			onSome: (userMessageId) => ({
				sessionId: runtime.sessionId,
				turnId: TurnId.make(userMessageId)
			})
		})
	})
})

// Builds the SAME contract event the tracer's ToolCallObserveCommand decider
// produces (see decider.ts's "tool.call.observe" case) -- ProjectionSessionActivities.ts
// only knows how to turn a ToolCallObserved event into a
// projection_session_activities row; a real Claude tool call folded into a
// generic SessionMetaUpdated (the bug this fixes) is invisible to that
// projector no matter what its encoded metadata says.
const makeToolCallObserved = Effect.fn("ClaudeAdapter.makeToolCallObserved")(function*(
	runtime: SessionRuntime,
	input: {
		readonly activityId: ActivityId
		readonly toolCallId: string
		readonly status: ObservedToolStatus
		readonly title: string
		readonly path: string | null
	}
) {
	const header = yield* stamp(runtime)
	return ToolCallObservedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "ToolCallObserved",
		payload: {
			sessionId: runtime.sessionId,
			activityId: input.activityId,
			toolCallId: ToolCallId.make(input.toolCallId),
			operationId: null,
			status: input.status,
			title: input.title,
			path: input.path
		}
	})
})

// A tool_call_update fact that arrives with no cached start info -- e.g. the
// SDK's own tool_use start was missed across a watchdog/resume boundary.
// Falls back to a generic, still-nonempty title rather than dropping the
// status transition on the floor; mergeActivityRow on the projector side
// will keep this only if no better title ever arrives for the same
// activityId.
const FALLBACK_TOOL_TITLE = "Tool"

const publishToolCallStarted = Effect.fn("ClaudeAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	const path = Option.getOrNull(toolCallPathHint(fact.kind, fact.rawInput))
	yield* Ref.update(runtime.openToolCalls, (current) =>
		HashMap.set(current, fact.toolCallId, { activityId, title: fact.title, path }))
	const event = yield* makeToolCallObserved(runtime, {
		activityId,
		toolCallId: fact.toolCallId,
		status: fact.status,
		title: fact.title,
		path
	})
	return yield* offerOutbound(runtime, event)
})

// #268 defect 2: a real Claude permission prompt used to fold into the
// generic makeMetaEvent/SessionMetaUpdated branch below, whose metadata
// nobody reads for approvals (ProjectionPendingApprovals.apply only reacts
// to a native ApprovalRequested/InteractionReplied event or an explicitly
// stamped pendingApproval metadata key -- neither ever happened here), so
// projection_pending_approvals never learned about it and the desktop panel
// had nothing to render: the turn just hung on an approval no one could see
// or answer. Mirrors publishToolCallStarted's own carve-out from the
// generic branch -- a real, typed event instead of an opaque metadata blob.
const publishApprovalRequested = Effect.fn("ClaudeAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "permission_request" }>
) {
	const header = yield* stamp(runtime)
	const approvalRequestId = ApprovalRequestId.make(fact.id)
	const event = ApprovalRequestedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "ApprovalRequested",
		payload: {
			sessionId: runtime.sessionId,
			approvalRequestId,
			title: fact.permission
		}
	})
	return yield* offerOutbound(runtime, event)
})

const publishToolCallUpdated = Effect.fn("ClaudeAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "tool_call_update" }>
) {
	if (fact.status === undefined) {
		// A pure streaming-argument update (input_json_delta) -- no status
		// transition to project, nothing worth a projection_session_activities
		// row for yet.
		return
	}
	const cache = yield* Ref.get(runtime.openToolCalls)
	const cached = HashMap.get(cache, fact.toolCallId)
	const info: OpenToolCallInfo = Option.getOrElse(cached, () => ({
		activityId: toolCallActivityId(fact.toolCallId),
		title: FALLBACK_TOOL_TITLE,
		path: null
	}))
	const event = yield* makeToolCallObserved(runtime, {
		activityId: info.activityId,
		toolCallId: fact.toolCallId,
		status: fact.status,
		title: info.title,
		path: info.path
	})
	return yield* offerOutbound(runtime, event)
})

const publishFact = Effect.fn("ClaudeAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: ClaudeContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	if (fact.contractKind === "turn_complete" || fact.contractKind === "turn_error") {
		// Closes the watchdog's window regardless of who ended the turn — the
		// SDK's own result message, or the watchdog itself synthesizing
		// turn_error for a stall it just recovered from.
		yield* Ref.set(runtime.turnOpenedAtMs, Option.none())
		const event = yield* makeCompleted(runtime)
		return yield* offerOutbound(runtime, event)
	}
	// A real Claude tool call must reach ProjectionSessionActivities as a
	// ToolCallObserved event, not fold into a generic SessionMetaUpdated one
	// (see makeToolCallObserved's doc) -- that was the live QA bug: a tool
	// call visibly executed but projection_session_activities stayed empty.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
	}
	// #268 defect 2: same carve-out as tool_call/tool_call_update above -- see
	// publishApprovalRequested's doc for why a permission request cannot stay
	// folded into the generic makeMetaEvent branch.
	if (fact.contractKind === "permission_request") {
		return yield* publishApprovalRequested(runtime, fact)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

const publishSdkMessage = Effect.fn("ClaudeAdapter.publishSdkMessage")(function*(
	runtime: SessionRuntime,
	raw: Json
) {
	const state = yield* Ref.get(runtime.streamState)
	const mapped = mapSdkMessage(state, raw)
	yield* Ref.set(runtime.streamState, mapped.state)
	yield* Effect.forEach(mapped.facts, (fact) => publishFact(runtime, fact), { discard: true })
})

const requireSession = Effect.fn("ClaudeAdapter.requireSession")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	sessionId: SessionId,
	operation: ProviderAdapterError["operation"]
) {
	const map = yield* Ref.get(sessions)
	const found = HashMap.get(map, sessionId)
	if (Option.isNone(found)) {
		return yield* adapterError(operation, `No Claude session '${sessionId}'.`)
	}
	return found.value
})

// Takes the runtime directly (not an indirection Ref) because by the time
// attachQuery builds this closure the runtime object already exists —
// openSession creates it BEFORE ever attaching a query, unlike the old
// single-query design where canUseTool had to be built before the runtime it
// would eventually belong to.
const bindCanUseTool = (
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

export type ClaudeQueryIsolation = {
	// When given, points query() at a system claude binary instead of the
	// SDK's own bundled native CLI (an optional platform dependency a
	// bundler's static analysis can't see and drops) — see
	// resolveClaudeExecutablePath in ClaudeProvider.ts for why this exists.
	readonly pathToClaudeCodeExecutable: Option.Option<string>
	// MCP servers Acepe itself wires in for this session, distinct from (and
	// never merged with) the operator's personal ~/.claude.json servers —
	// see CLAUDE_SESSION_MCP_SERVERS in ClaudeProvider.ts.
	readonly mcpServers: Record<string, McpServerConfig>
}

// Builds the exact options object passed to the SDK's query(). Pulled out as
// a pure function (no SDK call, no process spawn) so the isolation settings
// can be unit-tested directly instead of only through a live spawn.
//
// settingSources excludes the operator's 'user'-scoped config
// (~/.claude/settings.json — hooks) while keeping 'project'/'local' (the
// target repo's own CLAUDE.md / .claude/settings.json, legitimate task
// context). strictMcpConfig + the explicit mcpServers below stop the
// operator's ~/.claude.json personal MCP servers (a railway server, a
// personal-memory venv server, ...) from being inherited. Both settings were
// verified empirically against the real SDK: the defaults (neither set)
// spawn the operator's personal MCP server child processes on the first
// turn; either setting alone, and the combination, block that spawn while
// still returning a real reply. See CLAUDE_ISOLATED_SETTING_SOURCES and
// CLAUDE_STRICT_MCP_CONFIG in ClaudeProvider.ts for the fuller rationale.
export const buildClaudeQueryOptions = (
	input: {
		readonly cwd: string
		readonly canUseTool: ClaudeCanUseTool
		readonly resume?: Option.Option<string>
	},
	isolation: ClaudeQueryIsolation
): ClaudeSdkOptions => ({
	cwd: input.cwd,
	includePartialMessages: true,
	settingSources: [...CLAUDE_ISOLATED_SETTING_SOURCES],
	strictMcpConfig: CLAUDE_STRICT_MCP_CONFIG,
	mcpServers: isolation.mcpServers,
	...(Option.isSome(isolation.pathToClaudeCodeExecutable)
		? { pathToClaudeCodeExecutable: isolation.pathToClaudeCodeExecutable.value }
		: {}),
	...(input.resume !== undefined && Option.isSome(input.resume)
		? { resume: input.resume.value }
		: {}),
	canUseTool: (toolName, toolInput, options) =>
		input.canUseTool(toolName, jsonObjectFromValue(toolInput), {
			toolUseID: options.toolUseID
		})
})

export const makeLiveCreateQuery = (
	isolation: ClaudeQueryIsolation
) =>
(
	input: ClaudeQueryInput
): Effect.Effect<ClaudeQueryHandle, ProviderAdapterError> =>
	Effect.try({
		try: () => {
			const runtime = query({
				prompt: input.prompt,
				options: buildClaudeQueryOptions(input, isolation)
			})
			return {
				messages: Stream.fromAsyncIterable(runtime, (cause) =>
					adapterError("startSession", errorDetail(cause, "Claude query stream failed"))
				).pipe(
					Stream.mapEffect((message) =>
						Schema.decodeUnknownEffect(Schema.Json)(message).pipe(
							Effect.mapError(() =>
								adapterError("startSession", "Claude query message was not JSON")
							)
						)
					)
				),
				interrupt: Effect.tryPromise({
					try: () => runtime.interrupt(),
					catch: (cause) =>
						adapterError("cancelTurn", errorDetail(cause, "Claude interrupt failed"))
				}),
				close: Effect.sync(() => {
					runtime.close()
				})
			}
		},
		catch: (cause) => adapterError("startSession", errorDetail(cause, "Claude query failed"))
	})

// Tears down a query BOUNDED: interrupt() is the SDK's documented way to
// stop a running turn on a query that will keep accepting prompts, but if
// the SDK's own interrupt promise hangs (the wedge behind the real "cancel
// then the next message hangs forever" QA bug), it must never block the
// caller indefinitely — cancelTurn runs inline on ProviderBridge's single
// shared dispatcher fiber, so an unbounded hang here freezes EVERY session,
// not just this one. close() itself is a synchronous, fire-and-forget call
// (see makeLiveCreateQuery) that can't hang, so only interrupt() needs a
// timeout.
const teardownQuery = (
	queryHandle: ClaudeQueryHandle,
	interruptTimeout: Duration.Input
) =>
	queryHandle.interrupt.pipe(
		Effect.timeout(interruptTimeout),
		Effect.ignore,
		Effect.andThen(queryHandle.close),
		Effect.ignore
	)

export const makeClaudeAdapter = Effect.fn("makeClaudeAdapter")(function*(
	options: ClaudeAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())
	const cancelInterruptTimeout = options.cancelInterruptTimeout ?? DEFAULT_CANCEL_INTERRUPT_TIMEOUT
	const turnInactivityTimeout = options.turnInactivityTimeout ?? DEFAULT_TURN_INACTIVITY_TIMEOUT
	const watchdogPollInterval = options.watchdogPollInterval ?? DEFAULT_WATCHDOG_POLL_INTERVAL

	const decidePermission = Effect.fn("ClaudeAdapter.decidePermission")(function*(
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

	// (Re)attaches a query to an already-registered runtime: a fresh
	// promptQueue feeds a fresh SDK query(), a new listener fiber drains its
	// messages, and both are published atomically via promptQueueRef/queryRef
	// so sendPrompt/cancelTurn always see the current pair. Called once from
	// openSession for a session's first query, and again from cancelTurn /
	// the watchdog to recover from a cancel or a detected stall — resume
	// carries the SDK's own session id across that recovery when known, so
	// the recovered query continues the SAME conversation rather than
	// starting a blank one.
	//
	// The listener is forked into runtime.sessionScope, not the calling
	// fiber's own child tree: a restart can be triggered from ProviderBridge's
	// shared dispatcher fiber (cancelTurn) or the watchdog's own fiber, and
	// forkChild there would parent the listener to a fiber whose lifetime has
	// nothing to do with this session. sessionScope is the one thing that
	// actually spans the session's whole life — see openSession.
	// myGeneration is reserved by the CALLER (Ref.updateAndGet on
	// runtime.generation) before it tears down whatever query came before —
	// never inside attachQuery itself. Ending the old query's inbound queue
	// (teardownQuery's close call) can make its listener fiber's own
	// Effect.ensuring cleanup run before this function gets a chance to run
	// at all, cooperative scheduling gives no ordering guarantee either way —
	// so the generation bump MUST already be visible by the time that old
	// listener checks it, or a cancel/watchdog restart can race its own
	// recovery: the old listener sees a stale "I'm still current" reading and
	// tears the whole session down right as attachQuery is trying to save it.
	const attachQuery = Effect.fn("ClaudeAdapter.attachQuery")(function*(
		runtime: SessionRuntime,
		resume: Option.Option<string>,
		myGeneration: number
	) {
		const promptQueue = yield* Queue.unbounded<ClaudeUserPrompt, Done>()
		const queryHandle = yield* options.createQuery({
			prompt: Stream.toAsyncIterable(Stream.fromQueue(promptQueue)),
			cwd: runtime.workspaceRoot,
			canUseTool: bindCanUseTool(runtime, decidePermission),
			resume
		})
		yield* Ref.set(runtime.promptQueueRef, promptQueue)
		yield* Ref.set(runtime.queryRef, queryHandle)
		const attachedAt = yield* Clock.currentTimeMillis
		yield* Ref.set(runtime.lastActivityAtMs, attachedAt)
		const dropSession = Ref.update(sessions, (current) =>
			HashMap.remove(current, runtime.sessionId)
		)
		yield* queryHandle.messages.pipe(
			Stream.runForEach((raw) =>
				publishSdkMessage(runtime, raw).pipe(
					Effect.andThen(
						Clock.currentTimeMillis.pipe(
							Effect.flatMap((now) => Ref.set(runtime.lastActivityAtMs, now))
						)
					)
				)
			),
			Effect.ensuring(
				Effect.gen(function*() {
					const current = yield* Ref.get(runtime.generation)
					if (current !== myGeneration) {
						// Superseded by attachQuery running again (cancel or
						// watchdog recovery) — the newer generation's listener
						// now owns outbound/sessions, this one just exits quietly.
						return
					}
					yield* Queue.end(runtime.outbound).pipe(
						Effect.flatMap(() => dropSession),
						Effect.asVoid
					)
				})
			),
			Effect.forkIn(runtime.sessionScope, { startImmediately: true })
		)
	})

	// Recovers a session whose turn appears wedged: no provider stream
	// activity for turnInactivityTimeout while a turn is open. Synthesizes a
	// turn_error fact (the SAME contract shape a real SDK error already maps
	// to — see ClaudeSdkMap.ts's TurnErrorFact — so this needs no new event
	// type) to close the stuck turn in the projection, then tears down and
	// re-attaches the query so the NEXT sendPrompt works. Forked once per
	// session, for the session's whole lifetime, into sessionScope — so it is
	// interrupted automatically whenever the session's outer stream ends,
	// same as the query listener.
	const watchdogLoop = Effect.fn("ClaudeAdapter.watchdogLoop")(function*(
		runtime: SessionRuntime
	) {
		while (true) {
			yield* Effect.sleep(watchdogPollInterval)
			const turnOpenedAt = yield* Ref.get(runtime.turnOpenedAtMs)
			if (Option.isNone(turnOpenedAt)) {
				continue
			}
			const lastActivity = yield* Ref.get(runtime.lastActivityAtMs)
			const now = yield* Clock.currentTimeMillis
			const idleMs = now - lastActivity
			if (idleMs < Duration.toMillis(turnInactivityTimeout)) {
				continue
			}
			yield* Ref.set(runtime.turnOpenedAtMs, Option.none())
			yield* publishFact(runtime, {
				contractKind: "turn_error",
				detail:
					`No provider activity for ${Math.round(idleMs / 1000)}s while a turn was open; ` +
					"the turn was recovered by the inactivity watchdog."
			})
			const state = yield* Ref.get(runtime.streamState)
			const nextGeneration = yield* Ref.updateAndGet(runtime.generation, (current) => current + 1)
			const oldQuery = yield* Ref.get(runtime.queryRef)
			yield* teardownQuery(oldQuery, cancelInterruptTimeout)
			yield* attachQuery(runtime, state.providerSessionId, nextGeneration)
		}
	})

	const openSession = Effect.fn("ClaudeAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`Claude session '${request.sessionId}' is already open.`
			)
		}
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const streamState = yield* Ref.make(emptyClaudeStreamState)
		const lastUserMessageId = yield* Ref.make(Option.none<MessageId>())
		const sequence = yield* Ref.make(0)
		// See SessionRuntime's own doc and stamp()'s: real wall-clock time,
		// captured once here so it can never collide with whatever epoch a
		// PRIOR process used for this same sessionId (DEFECT D).
		const openEpochMs = yield* Clock.currentTimeMillis
		const pendingPermissions = yield* Ref.make(
			HashMap.empty<string, Deferred.Deferred<ClaudePermissionDecision>>()
		)
		const openToolCalls = yield* Ref.make(HashMap.empty<string, OpenToolCallInfo>())
		const sessionScope = yield* Scope.make()
		const placeholderQueue = yield* Queue.unbounded<ClaudeUserPrompt, Done>()
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			workspaceRoot: request.workspaceRoot,
			openEpochMs,
			outbound,
			streamState,
			lastUserMessageId,
			sequence,
			pendingPermissions,
			openToolCalls,
			promptQueueRef: yield* Ref.make(placeholderQueue),
			// Overwritten immediately by the attachQuery call below;
			// requireSession never observes a session without a real query
			// because openSession doesn't register it into `sessions` until
			// after that call returns.
			queryRef: yield* Ref.make<ClaudeQueryHandle>({
				messages: Stream.empty,
				interrupt: Effect.void,
				close: Effect.void
			}),
			generation: yield* Ref.make(-1),
			turnOpenedAtMs: yield* Ref.make(Option.none<number>()),
			lastActivityAtMs: yield* Ref.make(0),
			needsReattach: yield* Ref.make(false),
			sessionScope
		}
		const firstGeneration = yield* Ref.updateAndGet(runtime.generation, (current) => current + 1)
		yield* attachQuery(runtime, Option.none(), firstGeneration)
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		yield* watchdogLoop(runtime).pipe(Effect.forkIn(sessionScope, { startImmediately: true }))
		return runtime
	})

	const startSession = (request: StartSessionRequest) =>
		Stream.unwrap(
			Effect.gen(function*() {
				const runtime = yield* openSession(request)
				const opened = yield* makeMetaEvent(runtime, deferredOpenFact)
				return Stream.concat(Stream.make(opened), Stream.fromQueue(runtime.outbound)).pipe(
					// Whether this stream's consumer (ProviderBridge's per-session
					// forwarding fiber) ends normally (outbound got Queue.end'd —
					// see attachQuery's final-generation cleanup) or is interrupted
					// (session archived/deleted), sessionScope must close either
					// way: that's what stops the watchdog and any live query
					// listener from outliving the session.
					Stream.ensuring(Scope.close(runtime.sessionScope, Exit.void))
				)
			})
		)

	// A cancel (see cancelTurn) tears the query down but deliberately leaves
	// reattaching to whoever actually needs it next: sendPrompt checks
	// needsReattach first and, if set, attaches a fresh query (with resume,
	// when the SDK's own session id is known) before offering the prompt —
	// so a follow-up right after a cancel transparently lands on a working
	// query instead of the abandoned one.
	const sendPrompt = (request: SendPromptRequest) =>
		Stream.fromEffect(
			Effect.gen(function*() {
				const runtime = yield* requireSession(sessions, request.sessionId, "sendPrompt")
				const reattachNeeded = yield* Ref.get(runtime.needsReattach)
				if (reattachNeeded) {
					const state = yield* Ref.get(runtime.streamState)
					const nextGeneration = yield* Ref.updateAndGet(
						runtime.generation,
						(current) => current + 1
					)
					yield* attachQuery(runtime, state.providerSessionId, nextGeneration)
					yield* Ref.set(runtime.needsReattach, false)
				}
				yield* Ref.set(runtime.lastUserMessageId, Option.some(request.messageId))
				const state = yield* Ref.get(runtime.streamState)
				const promptQueue = yield* Ref.get(runtime.promptQueueRef)
				yield* Queue.offer(promptQueue, userPrompt(request.text, state.providerSessionId))
				const now = yield* Clock.currentTimeMillis
				yield* Ref.set(runtime.turnOpenedAtMs, Option.some(now))
				yield* Ref.set(runtime.lastActivityAtMs, now)
				return yield* makeMessageSent(runtime, request)
			})
		)

	// Tears down the current query (bounded — see teardownQuery) and marks
	// the session as needing a fresh one, WITHOUT attaching it here: per the
	// SDK's own docs, interrupt() is meant to leave a query ready for more
	// prompts on the same streaming session, but the real QA bug was exactly
	// a wedged interrupt leaving the query unusable afterward, so a fresh
	// query is unconditionally required going forward — just not spawned
	// eagerly. A cancel with no follow-up (the user walked away, or a caller
	// only cancelling for cleanup) must not spawn a real `claude` subprocess
	// nobody asked for; sendPrompt attaches the replacement lazily instead,
	// the same "don't eagerly restart what might not be used" principle
	// ProviderBridge's boot-replay fix already applies at the session level.
	const cancelTurn = Effect.fn("ClaudeAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const cancelled = yield* makeCancelled(runtime)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
		yield* Ref.set(runtime.turnOpenedAtMs, Option.none())
		// Bump generation BEFORE tearing the old query down (not after, and
		// not skipped just because nothing attaches a replacement here): once
		// its inbound queue ends, the old listener's own Effect.ensuring
		// cleanup can run before this function's next line does — cooperative
		// scheduling gives no ordering guarantee — so the "am I still
		// current?" check it makes must already see a bumped generation, or
		// it wrongly concludes it's still canonical and tears the whole
		// session down right as cancelTurn is trying to keep it alive for
		// sendPrompt's later lazy reattach. See attachQuery's own doc.
		yield* Ref.update(runtime.generation, (current) => current + 1)
		const oldQuery = yield* Ref.get(runtime.queryRef)
		yield* teardownQuery(oldQuery, cancelInterruptTimeout)
		yield* Ref.set(runtime.needsReattach, true)
	})

	const respondToPermission = Effect.fn("ClaudeAdapter.respondToPermission")(function*(input: {
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

	// Forcefully tears down every live session's query — SIGTERM-then-
	// SIGKILL-equivalent (per the SDK's own close() contract, see
	// makeLiveCreateQuery) on app/layer shutdown, not just on an explicit
	// cancel. This is what stops a spawned `claude` subprocess from
	// outliving the app: without a caller invoking this at shutdown, nothing
	// ever tears down a session that neither cancelled nor errored — see
	// ProviderBridge.ts's shutdown finalizer, which calls this on every
	// registered adapter that exposes it.
	const shutdown = Effect.gen(function*() {
		const current = yield* Ref.get(sessions)
		yield* Effect.forEach(
			HashMap.values(current),
			(runtime) =>
				Ref.get(runtime.queryRef).pipe(
					Effect.flatMap((queryHandle) => teardownQuery(queryHandle, cancelInterruptTimeout)),
					Effect.andThen(Scope.close(runtime.sessionScope, Exit.void))
				),
			{ discard: true, concurrency: "unbounded" }
		)
	}).pipe(Effect.withSpan("ClaudeAdapter.shutdown"))

	return {
		providerId: CLAUDE_PROVIDER_ID,
		capabilities: CLAUDE_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission,
		shutdown
	} satisfies ClaudeAdapter
})

export const makeLiveClaudeAdapter = Effect.fn("makeLiveClaudeAdapter")(function*() {
	const presenceValue = yield* probeClaudePresence()
	const executablePath = yield* resolveClaudeExecutablePath()
	return yield* makeClaudeAdapter({
		createQuery: makeLiveCreateQuery({
			pathToClaudeCodeExecutable: executablePath,
			mcpServers: CLAUDE_SESSION_MCP_SERVERS
		}),
		presence: Effect.succeed(presenceValue)
	})
})
