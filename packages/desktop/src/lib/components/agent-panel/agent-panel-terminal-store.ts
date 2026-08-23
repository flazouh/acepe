import {
	CommandId,
	DEFAULT_TERMINAL_COLS,
	DEFAULT_TERMINAL_ROWS,
	type ProjectedTerminal,
	type RpcClient,
	type SessionId,
	TerminalCloseCommand,
	TerminalId,
	TerminalInputCommand,
	TerminalOpenCommand,
	TerminalResizeCommand,
} from "@acepe/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

const randomToken = (): string =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const nextTerminalId = (): TerminalId => TerminalId.make(`terminal-${randomToken()}`);

const nextCommandId = (): CommandId => CommandId.make(`terminal-cmd-${randomToken()}`);

export const openTerminalCommand = (input: {
	readonly terminalId: TerminalId;
	readonly sessionId: SessionId;
	readonly cwd: string;
}): TerminalOpenCommand =>
	TerminalOpenCommand.make({
		type: "terminal.open",
		commandId: nextCommandId(),
		terminalId: input.terminalId,
		sessionId: input.sessionId,
		cwd: input.cwd,
		cols: DEFAULT_TERMINAL_COLS,
		rows: DEFAULT_TERMINAL_ROWS,
	});

export const inputTerminalCommand = (
	terminalId: TerminalId,
	data: string
): TerminalInputCommand | null => {
	if (data.length === 0) {
		return null;
	}
	return TerminalInputCommand.make({
		type: "terminal.input",
		commandId: nextCommandId(),
		terminalId,
		data,
	});
};

export const resizeTerminalCommand = (
	terminalId: TerminalId,
	cols: number,
	rows: number
): TerminalResizeCommand =>
	TerminalResizeCommand.make({
		type: "terminal.resize",
		commandId: nextCommandId(),
		terminalId,
		cols,
		rows,
	});

export const closeTerminalCommand = (terminalId: TerminalId): TerminalCloseCommand =>
	TerminalCloseCommand.make({
		type: "terminal.close",
		commandId: nextCommandId(),
		terminalId,
	});

// Live push from bun to the webview is broken in the Electrobun message
// transport (issue #261: pushes leave bun, receiveMessageFromBun never
// fires), so terminal output arrives the same way followSession's replies
// do — short polls against the snapshot RPC. Unlike followSession (which
// settles and stops once a send's stream goes quiet), this keeps polling for
// as long as the terminal view stays mounted: a shell can keep producing
// output indefinitely.
export const followTerminal = Effect.fn("followTerminal")(function* (input: {
	readonly client: RpcClient;
	readonly terminalId: TerminalId;
	readonly isActive: () => boolean;
	readonly onSnapshot: (terminal: ProjectedTerminal | null) => void;
}) {
	while (input.isActive()) {
		yield* Effect.sleep(Duration.millis(350));
		if (!input.isActive()) {
			return;
		}
		const snap = yield* input.client.snapshot({
			kind: "terminal",
			terminalId: input.terminalId,
		});
		input.onSnapshot(snap.terminal);
	}
});
