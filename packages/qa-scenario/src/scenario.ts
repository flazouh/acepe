/**
 * A QA scenario is one recording of the orchestration truth the app consumes:
 * the snapshots the server answered with, the events it pushed, and the
 * responses it gave to the side-channel calls (git, agent, file index).
 *
 * The same recording drives every QA level. Level 2 replays it through a fake
 * RpcClient, level 3 replays it through a scripted provider, and the capture
 * command writes it straight out of a real session's event log. Nothing here
 * re-implements a projection: a scenario carries what the server said, so a
 * replay cannot drift from the real contract.
 */

import {
	type SnapshotRequest,
	OrchestrationEvent,
	RpcSessionSnapshot,
	SessionId,
	snapshotScope,
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const NonEmptyText = Schema.String.check(Schema.isNonEmpty())

export const QaScenarioMetaLine = Schema.Struct({
	line: Schema.Literal("meta"),
	name: NonEmptyText,
	description: Schema.String,
	/** ISO instant the capture ran, or null for a hand-authored scenario. */
	capturedAt: Schema.NullOr(Schema.String),
	/**
	 * The canonical session this scenario is about. Branded rather than a bare
	 * string so a reader of the file is a session id everywhere it is used, and
	 * a recording that names something else fails to decode.
	 */
	capturedFromSessionId: Schema.NullOr(SessionId),
})
export type QaScenarioMetaLine = typeof QaScenarioMetaLine.Type

export const QaScenarioSnapshotLine = Schema.Struct({
	line: Schema.Literal("snapshot"),
	scopeKey: NonEmptyText,
	snapshot: RpcSessionSnapshot,
})
export type QaScenarioSnapshotLine = typeof QaScenarioSnapshotLine.Type

export const QaScenarioStepLine = Schema.Struct({
	line: Schema.Literal("step"),
	/** Milliseconds after the first event. Monotonic, never negative. */
	offsetMs: NonNegativeInt,
	event: OrchestrationEvent,
})
export type QaScenarioStepLine = typeof QaScenarioStepLine.Type

export const QaScenarioCallLine = Schema.Struct({
	line: Schema.Literal("call"),
	/** RpcTransport method name, e.g. "gitCall". */
	method: NonEmptyText,
	/** Stable key for the request, produced by `callKey`. */
	requestKey: Schema.String,
	response: Schema.Json,
})
export type QaScenarioCallLine = typeof QaScenarioCallLine.Type

export const QaScenarioLine = Schema.Union([
	QaScenarioMetaLine,
	QaScenarioSnapshotLine,
	QaScenarioStepLine,
	QaScenarioCallLine,
])
export type QaScenarioLine = typeof QaScenarioLine.Type

export const QaScenarioLineCodec = Schema.fromJsonString(QaScenarioLine)

export type QaScenario = {
	readonly meta: QaScenarioMetaLine
	readonly snapshots: ReadonlyArray<QaScenarioSnapshotLine>
	readonly steps: ReadonlyArray<QaScenarioStepLine>
	readonly calls: ReadonlyArray<QaScenarioCallLine>
}

export class QaScenarioDecodeError extends Schema.TaggedError<QaScenarioDecodeError>()(
	"QaScenarioDecodeError",
	{
		reason: Schema.String,
	},
) {
	override get message(): string {
		return `Invalid QA scenario: ${this.reason}`
	}
}

/**
 * The key a snapshot is stored and looked up under. Two requests that ask the
 * server for the same thing must produce the same key, so the replay answers a
 * `session:abc` request with the `session:abc` recording and nothing else.
 */
export const snapshotRequestKey = (request: SnapshotRequest): string => {
	const scope = snapshotScope(request)
	switch (scope.kind) {
		case "library":
		case "settings":
		case "skills":
		case "voice":
			return scope.kind
		case "git":
			return `git:${scope.projectId}`
		case "mcp":
			return `mcp:${scope.projectId}`
		case "project":
			return `project:${scope.projectId}`
		case "terminal":
			return `terminal:${scope.terminalId}`
		case "session":
			return `session:${scope.sessionId}`
	}
}

/**
 * The key a side-channel call is recorded under. JSON of the request is stable
 * enough because every request in the contract is a plain data struct.
 */
export const callKey = <A>(request: A): string => JSON.stringify(request)

const scenarioLines = (scenario: QaScenario): ReadonlyArray<QaScenarioLine> => [
	scenario.meta,
	...scenario.snapshots,
	...scenario.steps,
	...scenario.calls,
]

export const encodeScenario = Effect.fn("encodeScenario")(function* (scenario: QaScenario) {
	const encoded: Array<string> = []
	for (const line of scenarioLines(scenario)) {
		encoded.push(yield* Schema.encodeUnknownEffect(QaScenarioLineCodec)(line))
	}
	return `${encoded.join("\n")}\n`
})

export const decodeScenario = Effect.fn("decodeScenario")(function* (text: string) {
	const snapshots: Array<QaScenarioSnapshotLine> = []
	const steps: Array<QaScenarioStepLine> = []
	const calls: Array<QaScenarioCallLine> = []
	let meta: QaScenarioMetaLine | null = null

	for (const raw of text.split("\n")) {
		const trimmed = raw.trim()
		if (trimmed.length === 0) {
			continue
		}
		const line = yield* Schema.decodeUnknownEffect(QaScenarioLineCodec)(trimmed)
		switch (line.line) {
			case "meta":
				meta = line
				break
			case "snapshot":
				snapshots.push(line)
				break
			case "step":
				steps.push(line)
				break
			case "call":
				calls.push(line)
				break
		}
	}

	if (meta === null) {
		return yield* new QaScenarioDecodeError({ reason: "no meta line" })
	}
	return { meta, snapshots, steps, calls } satisfies QaScenario
})
