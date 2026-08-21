import {
	CheckpointId,
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	SessionId,
	TurnId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	deriveSessionTitleFromUserInput,
	evolveProjectedSession,
	getTitleUpdateFromUserMessage,
	isFallbackSessionTitle,
	ProjectedSession,
	ProjectionSessions,
	stripArtifactsFromTitle
} from "./ProjectionSessions.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")
const turnId = TurnId.make("turn-1")

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	| "SessionCreated"
	| "SessionMetaUpdated"
	| "SessionArchived"
	| "SessionUnarchived"
	| "SessionDeleted"
	| "MessageSent"
	| "TurnCancelled"
	| "CheckpointReverted"
>

const sessionEvent = <const Type extends SessionEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const projectCreated = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project" as const,
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated" as const,
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
}

const fold = (events: ReadonlyArray<OrchestrationEvent>) =>
	Effect.reduce(events, () => Option.none<typeof ProjectedSession.Type>(), evolveProjectedSession)

const requireSession = (row: Option.Option<typeof ProjectedSession.Type>) =>
	Option.match(row, {
		onNone: () => {
			Vitest.assert.fail("expected a projected session row")
			return undefined as never
		},
		onSome: (session) => session
	})

Vitest.describe("ProjectionSessions", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			ProjectionSessions.key,
			"@acepe/server/persistence/Services/ProjectionSessions"
		)
	})
})

Vitest.describe("isFallbackSessionTitle", () => {
	Vitest.it("detects known fallback titles", () => {
		Vitest.assert.isTrue(isFallbackSessionTitle("New Thread"))
		Vitest.assert.isTrue(isFallbackSessionTitle("New session"))
		Vitest.assert.isTrue(isFallbackSessionTitle("Loading..."))
		Vitest.assert.isTrue(isFallbackSessionTitle("Session 24745d00"))
		Vitest.assert.isFalse(isFallbackSessionTitle("Real title"))
		Vitest.assert.isFalse(isFallbackSessionTitle("Session planning"))
	})
})

Vitest.describe("stripArtifactsFromTitle", () => {
	Vitest.it("strips ide_opened_file artifacts", () => {
		Vitest.assert.strictEqual(
			stripArtifactsFromTitle(
				"<ide_opened_file>The user opened file.txt</ide_opened_file>My actual title"
			),
			"My actual title"
		)
	})

	Vitest.it("strips attachment tokens", () => {
		Vitest.assert.strictEqual(
			stripArtifactsFromTitle("@[image:/path/to/img.png] Fix the bug"),
			"Fix the bug"
		)
	})

	Vitest.it("strips expanded attachment refs", () => {
		Vitest.assert.strictEqual(
			stripArtifactsFromTitle("[Attached image: /var/folders/rw/tmp/screenshot.png] Fix the bug"),
			"Fix the bug"
		)
	})
})

Vitest.describe("deriveSessionTitleFromUserInput", () => {
	Vitest.it("uses the first meaningful line", () => {
		Vitest.assert.deepStrictEqual(
			deriveSessionTitleFromUserInput("Implement auth flow\nwith OAuth"),
			Option.some("Implement auth flow")
		)
	})

	Vitest.it("returns none for empty input or a slash command", () => {
		Vitest.assert.deepStrictEqual(deriveSessionTitleFromUserInput("   "), Option.none())
		Vitest.assert.deepStrictEqual(deriveSessionTitleFromUserInput("/help"), Option.none())
	})

	Vitest.it("strips artifacts before taking the first line", () => {
		Vitest.assert.deepStrictEqual(
			deriveSessionTitleFromUserInput(
				"<ide_opened_file>File.ts opened</ide_opened_file>Implement auth flow\nwith OAuth"
			),
			Option.some("Implement auth flow")
		)
	})
})

Vitest.describe("getTitleUpdateFromUserMessage", () => {
	Vitest.it("returns an update only when the current title is a fallback", () => {
		Vitest.assert.deepStrictEqual(
			getTitleUpdateFromUserMessage("New Thread", "Implement auth flow"),
			Option.some("Implement auth flow")
		)
		Vitest.assert.deepStrictEqual(
			getTitleUpdateFromUserMessage("Session 24745d00", "Investigate kanban crash"),
			Option.some("Investigate kanban crash")
		)
		Vitest.assert.deepStrictEqual(
			getTitleUpdateFromUserMessage("Real title", "Implement auth flow"),
			Option.none()
		)
	})

	Vitest.it("treats artifact-only titles as fallback", () => {
		Vitest.assert.deepStrictEqual(
			getTitleUpdateFromUserMessage(
				"<ide_opened_file>The user opened file.txt</ide_opened_file>",
				"Fix the login bug"
			),
			Option.some("Fix the login bug")
		)
	})
})

Vitest.describe("evolveProjectedSession", () => {
	Vitest.it.effect("ignores project events", () =>
		Effect.gen(function*() {
			const row = yield* fold([projectCreated])
			Vitest.assert.deepStrictEqual(row, Option.none())
		})
	)

	Vitest.it.effect("creates one row from SessionCreated", () =>
		Effect.gen(function*() {
			const row = requireSession(
				yield* fold([
					sessionEvent(1, "SessionCreated", NOW, {
						sessionId,
						projectId,
						title: "First session"
					})
				])
			)
			Vitest.assert.deepStrictEqual(row, {
				sessionId,
				projectId,
				title: "First session",
				provider: null,
				createdAt: NOW,
				updatedAt: NOW,
				lastActivityAt: NOW,
				archivedAt: null,
				deletedAt: null
			})
		})
	)

	Vitest.it.effect("strips artifacts from the created title", () =>
		Effect.gen(function*() {
			const row = requireSession(
				yield* fold([
					sessionEvent(1, "SessionCreated", NOW, {
						sessionId,
						projectId,
						title: "<ide_opened_file>File</ide_opened_file>Fix the login bug"
					})
				])
			)
			Vitest.assert.strictEqual(row.title, "Fix the login bug")
		})
	)

	Vitest.it.effect("falls back to the first user message when the created title is a fallback", () =>
		Effect.gen(function*() {
			const row = requireSession(
				yield* fold([
					sessionEvent(1, "SessionCreated", NOW, {
						sessionId,
						projectId,
						title: "New Thread"
					}),
					sessionEvent(2, "MessageSent", LATER, {
						sessionId,
						messageId,
						text: "Implement auth flow\nwith OAuth"
					})
				])
			)
			Vitest.assert.strictEqual(row.title, "Implement auth flow")
			Vitest.assert.strictEqual(row.updatedAt, LATER)
			Vitest.assert.strictEqual(row.lastActivityAt, LATER)
		})
	)

	Vitest.it.effect("keeps a real created title when a later user message arrives", () =>
		Effect.gen(function*() {
			const row = requireSession(
				yield* fold([
					sessionEvent(1, "SessionCreated", NOW, {
						sessionId,
						projectId,
						title: "Real title"
					}),
					sessionEvent(2, "MessageSent", LATER, {
						sessionId,
						messageId,
						text: "Implement auth flow"
					})
				])
			)
			Vitest.assert.strictEqual(row.title, "Real title")
		})
	)

	Vitest.it.effect("does not replace a derived title with a later user message", () =>
		Effect.gen(function*() {
			const row = requireSession(
				yield* fold([
					sessionEvent(1, "SessionCreated", NOW, {
						sessionId,
						projectId,
						title: "New Thread"
					}),
					sessionEvent(2, "MessageSent", LATER, {
						sessionId,
						messageId,
						text: "Implement auth flow"
					}),
					sessionEvent(3, "MessageSent", LATER, {
						sessionId,
						messageId: MessageId.make("message-2"),
						text: "And then add tests"
					})
				])
			)
			Vitest.assert.strictEqual(row.title, "Implement auth flow")
		})
	)

	Vitest.it.effect("represents archived and deleted sessions on the row, not by absence", () =>
		Effect.gen(function*() {
			const row = requireSession(
				yield* fold([
					sessionEvent(1, "SessionCreated", NOW, {
						sessionId,
						projectId,
						title: "First session"
					}),
					sessionEvent(2, "SessionArchived", LATER, {
						sessionId
					}),
					sessionEvent(3, "SessionDeleted", LATER, {
						sessionId
					})
				])
			)
			Vitest.assert.strictEqual(row.archivedAt, LATER)
			Vitest.assert.strictEqual(row.deletedAt, LATER)
		})
	)

	Vitest.it.effect("clears archivedAt on SessionUnarchived", () =>
		Effect.gen(function*() {
			const row = requireSession(
				yield* fold([
					sessionEvent(1, "SessionCreated", NOW, {
						sessionId,
						projectId,
						title: "First session"
					}),
					sessionEvent(2, "SessionArchived", LATER, {
						sessionId
					}),
					sessionEvent(3, "SessionUnarchived", LATER, {
						sessionId
					})
				])
			)
			Vitest.assert.strictEqual(row.archivedAt, null)
		})
	)

	Vitest.it.effect("applies an explicit SessionMetaUpdated title", () =>
		Effect.gen(function*() {
			const row = requireSession(
				yield* fold([
					sessionEvent(1, "SessionCreated", NOW, {
						sessionId,
						projectId,
						title: "New Thread"
					}),
					sessionEvent(2, "SessionMetaUpdated", LATER, {
						sessionId,
						title: "Renamed session"
					})
				])
			)
			Vitest.assert.strictEqual(row.title, "Renamed session")
		})
	)

	Vitest.it.effect("replays the same events to an identical row", () =>
		Effect.gen(function*() {
			const events: ReadonlyArray<OrchestrationEvent> = [
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "New Thread"
				}),
				sessionEvent(2, "MessageSent", LATER, {
					sessionId,
					messageId,
					text: "<ide_opened_file>File</ide_opened_file>Ship the lifecycle slice"
				}),
				sessionEvent(3, "TurnCancelled", LATER, {
					sessionId,
					turnId
				}),
				sessionEvent(4, "SessionArchived", LATER, {
					sessionId
				})
			]
			const first = yield* fold(events)
			const second = yield* fold(events)
			Vitest.assert.deepStrictEqual(first, second)
			Vitest.assert.strictEqual(requireSession(first).title, "Ship the lifecycle slice")
		})
	)

	Vitest.it.effect("does not change the session row when a checkpoint is reverted", () =>
		Effect.gen(function*() {
			const created = yield* fold([
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				})
			])
			const afterRevert = yield* fold([
				sessionEvent(1, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sessionEvent(2, "CheckpointReverted", LATER, {
					sessionId,
					checkpointId: CheckpointId.make("checkpoint-1")
				})
			])
			Vitest.assert.deepStrictEqual(created, afterRevert)
		})
	)
})
