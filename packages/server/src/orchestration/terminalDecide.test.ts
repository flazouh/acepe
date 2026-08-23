import {
	CommandId,
	EventId,
	ProjectId,
	SessionId,
	TerminalCloseCommand,
	TerminalId,
	TerminalInputCommand,
	TerminalOpenCommand,
	TerminalResizeCommand
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { OrchestrationReadModel } from "./commandInvariants.ts"
import { decideTerminal } from "./terminalDecide.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-terminal")
const eventId = EventId.make("event-terminal")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const terminalId = TerminalId.make("term-1")
const identity = { eventId, occurredAt }

const emptyReadModel: OrchestrationReadModel = {
	snapshotSequence: 0,
	projects: [],
	sessions: []
}

const withActiveSession: OrchestrationReadModel = {
	snapshotSequence: 3,
	projects: [{ id: projectId }],
	sessions: [{ id: sessionId, projectId, archivedAt: null, checkpoints: [] }]
}

const withArchivedSession: OrchestrationReadModel = {
	snapshotSequence: 3,
	projects: [{ id: projectId }],
	sessions: [{ id: sessionId, projectId, archivedAt: occurredAt, checkpoints: [] }]
}

Vitest.describe("decideTerminal", () => {
	Vitest.it.effect("rejects terminal.open when the session does not exist", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decideTerminal(
					emptyReadModel,
					TerminalOpenCommand.make({
						type: "terminal.open",
						commandId,
						terminalId,
						sessionId,
						cwd: "/tmp",
						cols: 80,
						rows: 24,
						output: "",
						closed: false
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "terminal.open")
		})
	)

	Vitest.it.effect("rejects terminal.open when the session is archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decideTerminal(
					withArchivedSession,
					TerminalOpenCommand.make({
						type: "terminal.open",
						commandId,
						terminalId,
						sessionId,
						cwd: "/tmp",
						cols: 80,
						rows: 24,
						output: "",
						closed: false
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
		})
	)

	Vitest.it.effect("emits TerminalOpened for a filled terminal.open", () =>
		Effect.gen(function*() {
			const events = yield* decideTerminal(
				withActiveSession,
				TerminalOpenCommand.make({
					type: "terminal.open",
					commandId,
					terminalId,
					sessionId,
					cwd: "/tmp",
					cols: 80,
					rows: 24,
					output: "",
					closed: false
				}),
				identity
			)
			Vitest.assert.strictEqual(events.length, 1)
			Vitest.assert.strictEqual(events[0]?.type, "TerminalOpened")
			Vitest.assert.strictEqual(events[0]?.aggregateKind, "terminal")
			Vitest.assert.strictEqual(events[0]?.aggregateId, terminalId)
			Vitest.assert.strictEqual(events[0]?.sequence, 4)
			if (events[0]?.type === "TerminalOpened") {
				Vitest.assert.strictEqual(events[0].payload.cwd, "/tmp")
				Vitest.assert.strictEqual(events[0].payload.closed, false)
			}
		})
	)

	Vitest.it.effect("emits TerminalOutputAppended for a filled terminal.input", () =>
		Effect.gen(function*() {
			const events = yield* decideTerminal(
				withActiveSession,
				TerminalInputCommand.make({
					type: "terminal.input",
					commandId,
					terminalId,
					data: "echo hi\n",
					sessionId,
					cwd: "/tmp",
					cols: 80,
					rows: 24,
					output: "echo hi\nhi\n",
					closed: false
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "TerminalOutputAppended")
			if (events[0]?.type === "TerminalOutputAppended") {
				Vitest.assert.strictEqual(events[0].payload.output, "echo hi\nhi\n")
			}
		})
	)

	Vitest.it.effect("emits TerminalOutputAppended for a filled terminal.resize", () =>
		Effect.gen(function*() {
			const events = yield* decideTerminal(
				withActiveSession,
				TerminalResizeCommand.make({
					type: "terminal.resize",
					commandId,
					terminalId,
					cols: 120,
					rows: 40,
					sessionId,
					cwd: "/tmp",
					output: "",
					closed: false
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "TerminalOutputAppended")
			if (events[0]?.type === "TerminalOutputAppended") {
				Vitest.assert.strictEqual(events[0].payload.cols, 120)
				Vitest.assert.strictEqual(events[0].payload.rows, 40)
			}
		})
	)

	Vitest.it.effect("emits TerminalClosed for a filled terminal.close", () =>
		Effect.gen(function*() {
			const events = yield* decideTerminal(
				withActiveSession,
				TerminalCloseCommand.make({
					type: "terminal.close",
					commandId,
					terminalId,
					sessionId,
					cwd: "/tmp",
					cols: 80,
					rows: 24,
					output: "bye\n",
					closed: true
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "TerminalClosed")
			if (events[0]?.type === "TerminalClosed") {
				Vitest.assert.strictEqual(events[0].payload.closed, true)
			}
		})
	)

	Vitest.it.effect("fails loud when terminal.input reaches the decider unfilled", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decideTerminal(
					withActiveSession,
					TerminalInputCommand.make({
						type: "terminal.input",
						commandId,
						terminalId,
						data: "echo hi\n"
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "terminal.input")
		})
	)
})
