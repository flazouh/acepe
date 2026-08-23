import {
	type EventId,
	type IsoDateTime,
	type JsonObject,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type Sequence
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

type TerminalEventType = "TerminalOpened" | "TerminalOutputAppended" | "TerminalClosed"

const EMPTY_METADATA: JsonObject = {}

const nextSequence = (snapshotSequence: Sequence): Sequence => snapshotSequence + 1

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

const terminalEventType = (commandType: TerminalCommand["type"]): TerminalEventType => {
	switch (commandType) {
		case "terminal.open":
			return "TerminalOpened"
		case "terminal.close":
			return "TerminalClosed"
		case "terminal.input":
		case "terminal.resize":
			return "TerminalOutputAppended"
	}
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
	const event = {
		sequence,
		eventId: identity.eventId,
		aggregateKind: "terminal",
		aggregateId: command.terminalId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId,
		causationEventId: null,
		correlationId: command.commandId,
		metadata: EMPTY_METADATA,
		type: terminalEventType(command.type),
		payload: {
			terminalId: command.terminalId,
			sessionId,
			cwd,
			cols,
			rows,
			output: command.output ?? "",
			closed: command.closed ?? false
		}
	} as OrchestrationEvent
	return [event]
})
