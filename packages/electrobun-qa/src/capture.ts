/**
 * `electrobun-qa capture` -- turn a live session into a replayable scenario.
 *
 * The collection runs inside the app, through the app's own RpcClient, so the
 * file holds what the server actually answered. This side only drives the
 * start/read pair and encodes the result, because `qa:eval` in the preload
 * refuses promises and cannot await an in-app subscription.
 */

import { OrchestrationEvent, RpcSessionSnapshot, SessionId } from "@acepe/contracts"
import type { QaScenario, QaScenarioSnapshotLine, QaScenarioStepLine } from "@acepe/qa-scenario"
import { encodeScenario } from "@acepe/qa-scenario"
import * as Arr from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"

import { QaCaptureFailed } from "./errors.ts"
import type { QaSession } from "./host/session.ts"

const DEFAULT_QUIET_MS = 400
const DEFAULT_POLL_MS = 200
const MAX_POLLS = 100
/**
 * Events per read. The preload gives an eval 5s, and a page has to cross the
 * socket inside that, so this is sized for a comfortable margin rather than
 * for the fewest round trips.
 */
const EVENT_PAGE_SIZE = 100
const MAX_EVENT_PAGES = 500

/**
 * A capture shares the Electrobun bridge with the event replay it just asked
 * for, so its own eval answers queue behind that burst. The default 5s helper
 * deadline is sized for a DOM read on an idle app and fails every capture on a
 * library with real history. This is sized for the burst instead.
 */
const CAPTURE_DEADLINE = Duration.seconds(60)

export type CaptureArgs = {
	readonly sessionId: SessionId
	readonly out: string
	readonly name: string
	readonly description: string
	readonly quietMs: number
}

const flagValue = (argv: ReadonlyArray<string>, flag: string): Option.Option<string> => {
	const index = argv.indexOf(flag)
	if (index < 0) {
		return Option.none()
	}
	const value = argv[index + 1]
	return value === undefined || value.startsWith("--") ? Option.none() : Option.some(value)
}

/**
 * argv is text; a session id is a branded value. Decoding here is the boundary,
 * so nothing downstream has to assume a bare string is a canonical id.
 */
export const parseCaptureArgs = Effect.fn("parseCaptureArgs")(function* (
	argv: ReadonlyArray<string>,
) {
	const raw = flagValue(argv, "--session")
	if (Option.isNone(raw)) {
		return yield* new QaCaptureFailed({
			reason: "capture needs --session <canonical session id>",
		})
	}
	const sessionId = yield* Schema.decodeUnknownEffect(SessionId)(raw.value).pipe(
		Effect.mapError(
			(error) => new QaCaptureFailed({ reason: `--session is not a session id: ${error.message}` }),
		),
	)
	const name = Option.getOrElse(flagValue(argv, "--name"), () => raw.value)
	const quiet = Option.map(flagValue(argv, "--quiet-ms"), (value) => Number.parseInt(value, 10))
	return {
		sessionId,
		out: Option.getOrElse(
			flagValue(argv, "--out"),
			() => `packages/qa-scenario/scenarios/${name}.ndjson`,
		),
		name,
		description: Option.getOrElse(
			flagValue(argv, "--description"),
			() => `captured from session ${raw.value}`,
		),
		quietMs: Option.match(quiet, {
			onNone: () => DEFAULT_QUIET_MS,
			onSome: (value) => (Number.isFinite(value) && value > 0 ? value : DEFAULT_QUIET_MS),
		}),
	} satisfies CaptureArgs
})

const CaptureProgress = Schema.Struct({
	done: Schema.Boolean,
	error: Schema.NullOr(Schema.String),
	sessionId: Schema.NullOr(Schema.String),
	eventCount: Schema.Number,
})

/**
 * Decoding the capture through the canonical schemas is the point: a recording
 * that does not match the orchestration contract is not a scenario, and it
 * should fail here rather than at replay time in someone else's test.
 */
const CapturedEvents = Schema.Array(OrchestrationEvent)

const CapturedSnapshots = Schema.Array(
	Schema.Struct({
		scopeKey: Schema.String,
		snapshot: RpcSessionSnapshot,
	}),
)

export type CapturedState = {
	readonly events: ReadonlyArray<typeof OrchestrationEvent.Type>
	readonly snapshots: ReadonlyArray<typeof CapturedSnapshots.Type[number]>
}

const decodeProgress = Schema.decodeUnknownEffect(CaptureProgress)
const decodeEvents = Schema.decodeUnknownEffect(CapturedEvents)
const decodeSnapshots = Schema.decodeUnknownEffect(CapturedSnapshots)

/**
 * Offsets come from the events' own `occurredAt`, so a replay reproduces the
 * pacing the provider actually produced instead of an invented cadence.
 */
export const stepsFromEvents = (
	events: ReadonlyArray<{ readonly occurredAt: string }>,
): ReadonlyArray<{ readonly offsetMs: number }> => {
	const first = events[0]
	if (first === undefined) {
		return []
	}
	const start = DateTime.make(first.occurredAt)
	if (Option.isNone(start)) {
		return events.map(() => ({ offsetMs: 0 }))
	}
	const startMs = DateTime.toEpochMillis(start.value)
	let previous = 0
	return events.map((event) => {
		const at = DateTime.make(event.occurredAt)
		if (Option.isNone(at)) {
			return { offsetMs: previous }
		}
		const offset = DateTime.toEpochMillis(at.value) - startMs
		previous = offset > previous ? offset : previous
		return { offsetMs: previous }
	})
}

const scenarioFromCapture = (args: CaptureArgs, state: CapturedState, capturedAt: string) => {
	const timings = stepsFromEvents(state.events)
	const steps: ReadonlyArray<QaScenarioStepLine> = state.events.map((event, index) => ({
		line: "step",
		offsetMs: timings[index]?.offsetMs ?? 0,
		event,
	}))
	const snapshots: ReadonlyArray<QaScenarioSnapshotLine> = state.snapshots.map((entry) => ({
		line: "snapshot",
		scopeKey: entry.scopeKey,
		snapshot: entry.snapshot,
	}))
	return {
		meta: {
			line: "meta",
			name: args.name,
			description: args.description,
			capturedAt,
			capturedFromSessionId: args.sessionId,
		},
		snapshots,
		steps,
		calls: [],
	} satisfies QaScenario
}

const startCapture = (args: CaptureArgs) =>
	`window.__acepeQaCaptureStart(${JSON.stringify(args.sessionId)}, ${String(args.quietMs)})`

const READ_PROGRESS = "window.__acepeQaCaptureProgress()"

const readEventsSource = (offset: number, limit: number): string =>
	`window.__acepeQaCaptureReadEvents(${String(offset)}, ${String(limit)})`

const READ_SNAPSHOTS = "window.__acepeQaCaptureReadSnapshots()"

/**
 * Pulls the finished capture across one page at a time. The event count from
 * progress is the contract: reading exactly that many events means a short page
 * is a real end, not a silently truncated capture.
 */
const drainCapture = Effect.fn("drainCapture")(function* (
	session: QaSession,
	eventCount: number,
) {
	const events: Array<typeof OrchestrationEvent.Type> = []
	let page = 0
	while (events.length < eventCount) {
		if (page >= MAX_EVENT_PAGES) {
			return yield* new QaCaptureFailed({
				reason: `capture of ${String(eventCount)} events did not finish in ${String(MAX_EVENT_PAGES)} pages`,
			})
		}
		const raw = yield* session
			.call(
				"qa:eval",
				{ source: readEventsSource(events.length, EVENT_PAGE_SIZE) },
				CAPTURE_DEADLINE,
			)
			.pipe(Effect.mapError((error) => new QaCaptureFailed({ reason: error.message })))
		const decoded = yield* decodeEvents(raw).pipe(
			Effect.mapError(
				(error) =>
					new QaCaptureFailed({
						reason: `the capture does not match the orchestration contract: ${error.message}`,
					}),
			),
		)
		if (decoded.length === 0) {
			return yield* new QaCaptureFailed({
				reason: `the app stopped answering after ${String(events.length)} of ${String(eventCount)} events`,
			})
		}
		for (const event of decoded) {
			events.push(event)
		}
		page = page + 1
	}

	const rawSnapshots = yield* session
		.call("qa:eval", { source: READ_SNAPSHOTS }, CAPTURE_DEADLINE)
		.pipe(Effect.mapError((error) => new QaCaptureFailed({ reason: error.message })))
	const snapshots = yield* decodeSnapshots(rawSnapshots).pipe(
		Effect.mapError(
			(error) =>
				new QaCaptureFailed({ reason: `the captured snapshots are unreadable: ${error.message}` }),
		),
	)
	return { events, snapshots } satisfies CapturedState
})

export const captureScenario = Effect.fn("captureScenario")(function* (
	session: QaSession,
	args: CaptureArgs,
) {
	yield* session
		.call("qa:eval", { source: startCapture(args) }, CAPTURE_DEADLINE)
		.pipe(
			Effect.mapError(
				(error) =>
					new QaCaptureFailed({
						reason: `the app has no capture hook installed (${error.message})`,
					}),
			),
		)

	let polls = 0
	while (polls < MAX_POLLS) {
		yield* Effect.sleep(Duration.millis(DEFAULT_POLL_MS))
		polls = polls + 1
		const raw = yield* session
			.call("qa:eval", { source: READ_PROGRESS }, CAPTURE_DEADLINE)
			.pipe(Effect.mapError((error) => new QaCaptureFailed({ reason: error.message })))
		const progress = yield* decodeProgress(raw).pipe(
			Effect.mapError(
				(error) =>
					new QaCaptureFailed({ reason: `capture progress was unreadable: ${error.message}` }),
			),
		)
		if (progress.error !== null) {
			return yield* new QaCaptureFailed({ reason: progress.error })
		}
		if (progress.done === true) {
			return yield* drainCapture(session, progress.eventCount)
		}
	}
	return yield* new QaCaptureFailed({
		reason: `the app did not finish capturing after ${String((MAX_POLLS * DEFAULT_POLL_MS) / 1000)}s`,
	})
})

export const encodeCapturedScenario = Effect.fn("encodeCapturedScenario")(function* (
	args: CaptureArgs,
	state: CapturedState,
) {
	const capturedAt = yield* Effect.map(DateTime.now, DateTime.formatIso)
	const scenario = scenarioFromCapture(args, state, capturedAt)
	const text = yield* encodeScenario(scenario).pipe(
		Effect.mapError(
			(error) =>
				new QaCaptureFailed({
					reason: `captured events do not match the orchestration contract: ${error.message}`,
				}),
		),
	)
	return { text, stepCount: Arr.length(scenario.steps) }
})

export const writeScenarioFile = Effect.fn("writeScenarioFile")(function* (
	target: string,
	text: string,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = path.dirname(target)
	yield* fs.makeDirectory(directory, { recursive: true }).pipe(
		Effect.mapError(
			(error) =>
				new QaCaptureFailed({ reason: `could not create ${directory}: ${error.message}` }),
		),
	)
	yield* fs
		.writeFileString(target, text)
		.pipe(
			Effect.mapError(
				(error) => new QaCaptureFailed({ reason: `could not write ${target}: ${error.message}` }),
			),
		)
})
