import {
	type EventId,
	type IsoDateTime,
	type JsonObject,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type Sequence,
	type TerminalClosedEvent,
	type TerminalClosedPayload,
	type TerminalOpenedEvent,
	type TerminalOutputAppendedEvent
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { requireSessionNotArchived, type OrchestrationReadModel } from "./commandInvariants.ts"
import { OrchestrationCommandInvariantError } from "./Errors.ts"

type TerminalDecideIdentity = {
	readonly eventId: EventId
	readonly occurredAt: IsoDateTime
}

export type TerminalCommand = Extract<
	OrchestrationCommand,
	{
		readonly type: "terminal.open" | "terminal.input" | "terminal.resize" | "terminal.close"
	}
>

const EMPTY_METADATA: JsonObject = {}

const nextSequence = (snapshotSequence: Sequence): Sequence => snapshotSequence + 1

// TerminalOpened/TerminalOutputAppended/TerminalClosed share one payload
// shape (see events.ts: every terminal event replaces the projected terminal
// wholesale), so one envelope builder plus three thin, explicitly-typed
// constructors covers all three without a cast to the OrchestrationEvent
// union at the call site.
const terminalEnvelope = (
	command: TerminalCommand,
	identity: TerminalDecideIdentity,
	sequence: Sequence,
	payload: TerminalClosedPayload
) => ({
	sequence,
	eventId: identity.eventId,
	aggregateKind: "terminal" as const,
	aggregateId: command.terminalId,
	occurredAt: identity.occurredAt,
	commandId: command.commandId,
	causationEventId: null,
	correlationId: command.commandId,
	metadata: EMPTY_METADATA,
	payload
})

const terminalOpenedEvent = (
	command: TerminalCommand,
	identity: TerminalDecideIdentity,
	sequence: Sequence,
	payload: TerminalClosedPayload
): TerminalOpenedEvent => ({
	...terminalEnvelope(command, identity, sequence, payload),
	type: "TerminalOpened"
})

const terminalOutputAppendedEvent = (
	command: TerminalCommand,
	identity: TerminalDecideIdentity,
	sequence: Sequence,
	payload: TerminalClosedPayload
): TerminalOutputAppendedEvent => ({
	...terminalEnvelope(command, identity, sequence, payload),
	type: "TerminalOutputAppended"
})

const terminalClosedEvent = (
	command: TerminalCommand,
	identity: TerminalDecideIdentity,
	sequence: Sequence,
	payload: TerminalClosedPayload
): TerminalClosedEvent => ({
	...terminalEnvelope(command, identity, sequence, payload),
	type: "TerminalClosed"
})

// terminal.open/input/resize/close all reach here through fillTerminalCommand
// (packages/server/src/terminal/fillCommand.ts), which calls the live
// TerminalService and stuffs the resolved sessionId/cwd/cols/rows onto the
// command before the pure decider runs. If a field is still missing here, the
// fill step was skipped or failed silently, so we fail loud instead of
// emitting a malformed event.
const requireFilled = <A>(
	command: TerminalCommand,
	value: A | undefined,
	field: string
): Effect.Effect<A, OrchestrationCommandInvariantError> => {
	if (value === undefined) {
		return Effect.fail(
			new OrchestrationCommandInvariantError({
				commandType: command.type,
				detail: `Command '${command.type}' reached the decider without a filled '${field}'.`
			})
		)
	}
	return Effect.succeed(value)
}

export const decideTerminal = Effect.fn("decideTerminal")(function*(
	readModel: OrchestrationReadModel,
	command: TerminalCommand,
	identity: TerminalDecideIdentity
): Effect.fn.Return<ReadonlyArray<OrchestrationEvent>, OrchestrationCommandInvariantError> {
	const sessionId = yield* requireFilled(command, command.sessionId, "sessionId")
	const cwd = yield* requireFilled(command, command.cwd, "cwd")
	const cols = yield* requireFilled(command, command.cols, "cols")
	const rows = yield* requireFilled(command, command.rows, "rows")

	if (command.type === "terminal.open") {
		yield* requireSessionNotArchived({ readModel, command, sessionId })
	}

	const sequence = nextSequence(readModel.snapshotSequence)
	const payload: TerminalClosedPayload = {
		terminalId: command.terminalId,
		sessionId,
		cwd,
		cols,
		rows,
		output: command.output ?? "",
		closed: command.closed ?? false
	}

	switch (command.type) {
		case "terminal.open":
			return [terminalOpenedEvent(command, identity, sequence, payload)]
		case "terminal.close":
			return [terminalClosedEvent(command, identity, sequence, payload)]
		case "terminal.input":
		case "terminal.resize":
			return [terminalOutputAppendedEvent(command, identity, sequence, payload)]
	}
})
