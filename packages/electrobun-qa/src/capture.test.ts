import { decodeScenario } from "@acepe/qa-scenario"
import { describe, expect, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { parseCaptureArgs, stepsFromEvents } from "./capture.ts"
import { executeCli } from "./cli.ts"
import { QaWindowNotFound } from "./errors.ts"
import { QaWindowInfo } from "./host/protocol.ts"
import type { QaSession } from "./host/session.ts"

const sessionId = "session-1"
const projectId = "project-1"

const event = (sequence: number, occurredAt: string, type: string, payload: unknown) => ({
	sequence,
	eventId: `event-${String(sequence)}`,
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId: `command-${String(sequence)}`,
	causationEventId: null,
	correlationId: `correlation-${sessionId}`,
	metadata: {},
	type,
	payload,
})

const capturedEvents = [
	event(1, "2026-08-27T10:00:00.000Z", "SessionCreated", {
		sessionId,
		projectId,
		title: "Ship the slice",
	}),
	event(2, "2026-08-27T10:00:00.250Z", "MessageSent", {
		sessionId,
		messageId: "message-1",
		text: "Ship the slice",
	}),
	event(3, "2026-08-27T10:00:00.900Z", "TokenAppended", {
		sessionId,
		messageId: "message-1:assistant",
		token: "Hello",
	}),
]

const emptySnapshot = {
	snapshotSequence: 3,
	session: null,
	messages: [],
	turns: [],
	activities: [],
	pendingApprovals: [],
	checkpoints: [],
	projects: [],
	sessions: [],
	settings: [],
	skillsCatalog: null,
	voice: null,
	gitReview: null,
	mcpCatalog: null,
	preconnectionOptions: null,
	terminal: null,
	sessionReviewState: null,
}

const window = QaWindowInfo.make({
	id: "1",
	title: "Acepe",
	url: "views://mainview/index.html",
})

const sourceOf = (params: unknown): string => {
	if (typeof params !== "object" || params === null || "source" in params === false) {
		return ""
	}
	const source = Reflect.get(params, "source")
	return typeof source === "string" ? source : ""
}

/** Answers the start/progress/page protocol the same way the in-app hook does. */
const captureSession = (
	pageRequests: Array<{ offset: number; limit: number }>,
	events: ReadonlyArray<ReturnType<typeof event>> = capturedEvents,
): QaSession => {
	let started = false
	const call: QaSession["call"] = (method, params) => {
		const source = sourceOf(params)
		if (method !== "qa:eval") {
			return Effect.succeed(null)
		}
		if (source.includes("__acepeQaCaptureStart")) {
			started = true
			return Effect.succeed(sessionId)
		}
		if (source.includes("__acepeQaCaptureProgress")) {
			return Effect.succeed({
				done: started,
				error: null,
				sessionId,
				eventCount: events.length,
			})
		}
		if (source.includes("__acepeQaCaptureReadSnapshots")) {
			return Effect.succeed([
				{ scopeKey: `session:${sessionId}`, snapshot: emptySnapshot },
				{ scopeKey: "library", snapshot: emptySnapshot },
			])
		}
		const page = /ReadEvents\((\d+), (\d+)\)/.exec(source)
		if (page === null) {
			return Effect.succeed(null)
		}
		const offset = Number(page[1])
		const limit = Number(page[2])
		pageRequests.push({ offset, limit })
		return Effect.succeed(events.slice(offset, offset + limit))
	}
	return {
		doctor: () => Effect.succeed("doctor: ok"),
		listWindows: () => Effect.succeed([window]),
		firstWindow: () => Effect.succeed(window),
		useWindow: (windowId) =>
			windowId === window.id
				? Effect.succeed(window)
				: Effect.fail(new QaWindowNotFound({ windowId })),
		windowInfo: () => Effect.succeed(window),
		call,
		handleSocketRequest: () => Effect.succeed(null),
	}
}

describe("parseCaptureArgs", () => {
	it.effect("refuses to run without a session id", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(parseCaptureArgs(["capture"]))
			expect(exit._tag).toBe("Failure")
		}),
	)

	it.effect("defaults the output path to the scenario library", () =>
		Effect.gen(function* () {
			const args = yield* parseCaptureArgs(["capture", "--session", sessionId])
			expect(args.out).toBe("packages/qa-scenario/scenarios/session-1.ndjson")
			expect(args.name).toBe(sessionId)
			expect(args.quietMs).toBe(400)
		}),
	)

	it.effect("honours an explicit name, path and quiet window", () =>
		Effect.gen(function* () {
			const args = yield* parseCaptureArgs([
				"capture",
				"--session",
				sessionId,
				"--name",
				"streaming-reply",
				"--out",
				"/tmp/acepe/streaming-reply.ndjson",
				"--quiet-ms",
				"900",
			])
			expect(args.name).toBe("streaming-reply")
			expect(args.out).toBe("/tmp/acepe/streaming-reply.ndjson")
			expect(args.quietMs).toBe(900)
		}),
	)
})

describe("stepsFromEvents", () => {
	it("keeps the pacing the provider actually produced", () => {
		expect(stepsFromEvents(capturedEvents)).toEqual([
			{ offsetMs: 0 },
			{ offsetMs: 250 },
			{ offsetMs: 900 },
		])
	})

	it("an empty capture has no steps", () => {
		expect(stepsFromEvents([])).toEqual([])
	})
})

describe("capture through the CLI", () => {
	/**
	 * A library's history runs to thousands of events. One call carrying all of
	 * them past the preload's 5s eval deadline fails the capture at the last
	 * step, after the collection already succeeded. This is that regression:
	 * 600 events must arrive as pages, none dropped and none repeated.
	 */
	it.live("pages a capture too large for one eval", () =>
		Effect.gen(function* () {
			const many = Array.from({ length: 600 }, (_ignored, index) =>
				event(index + 1, `2026-08-27T10:00:0${String(index % 10)}.000Z`, "TokenAppended", {
					sessionId,
					messageId: "message-1:assistant",
					token: `t${String(index)}`,
				}),
			)
			const pageRequests: Array<{ offset: number; limit: number }> = []
			const written: Array<{ readonly path: string; readonly text: string }> = []
			const result = yield* executeCli({
				argv: ["capture", "--session", sessionId, "--out", "/tmp/acepe/big.ndjson"],
				stdin: Effect.succeed(""),
				session: captureSession(pageRequests, many),
				writeFile: (path, text) =>
					Effect.sync(() => {
						written.push({ path, text })
					}),
			}).pipe(Effect.timeout(Duration.seconds(20)))

			expect(result.code).toBe(0)
			expect(pageRequests.length).toBeGreaterThan(1)
			expect(pageRequests.every((request) => request.limit <= 250)).toBe(true)

			const scenario = yield* decodeScenario(written[0]?.text ?? "")
			expect(scenario.steps.length).toBe(600)
			const tokens = scenario.steps.map((step, index) => step.event.sequence === index + 1)
			expect(tokens.every((inOrder) => inOrder)).toBe(true)
		}),
	)

	it.live("writes a scenario the replay package can decode", () =>
		Effect.gen(function* () {
			const pageRequests: Array<{ offset: number; limit: number }> = []
			const written: Array<{ readonly path: string; readonly text: string }> = []
			const result = yield* executeCli({
				argv: ["capture", "--session", sessionId, "--out", "/tmp/acepe/qa-capture.ndjson"],
				stdin: Effect.succeed(""),
				session: captureSession(pageRequests),
				writeFile: (path, text) =>
					Effect.sync(() => {
						written.push({ path, text })
					}),
			}).pipe(Effect.timeout(Duration.seconds(10)))

			expect(result.code).toBe(0)
			expect(written.length).toBe(1)
			expect(written[0]?.path).toBe("/tmp/acepe/qa-capture.ndjson")

			const scenario = yield* decodeScenario(written[0]?.text ?? "")
			expect(scenario.meta.capturedFromSessionId).toBe(sessionId)
			expect(scenario.steps.map((step) => step.event.type)).toEqual([
				"SessionCreated",
				"MessageSent",
				"TokenAppended",
			])
			expect(scenario.steps.map((step) => step.offsetMs)).toEqual([0, 250, 900])
			expect(scenario.snapshots.map((line) => line.scopeKey)).toEqual([
				"session:session-1",
				"library",
			])
		}),
	)
})
