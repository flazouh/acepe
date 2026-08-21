import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import type {
	CreateTerminalParams,
	CreateTerminalResult,
	TerminalOutputResult,
	WaitForExitResult,
} from "../../acp/types/index.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const terminalCommands = TAURI_COMMAND_CLIENT.terminal;

export const terminal = {
	create: (request: CreateTerminalParams): Effect.Effect<CreateTerminalResult, AppError> => {
		return terminalCommands.create.invoke<CreateTerminalResult>({ request });
	},

	output: (sessionId: string, terminalId: string): Effect.Effect<TerminalOutputResult, AppError> => {
		return terminalCommands.output.invoke<TerminalOutputResult>({ sessionId, terminalId });
	},

	waitForExit: (
		sessionId: string,
		terminalId: string
	): Effect.Effect<WaitForExitResult, AppError> => {
		return terminalCommands.wait_for_exit.invoke<WaitForExitResult>({ sessionId, terminalId });
	},

	kill: (sessionId: string, terminalId: string): Effect.Effect<void, AppError> => {
		return terminalCommands.kill.invoke<void>({ sessionId, terminalId });
	},

	release: (sessionId: string, terminalId: string): Effect.Effect<void, AppError> => {
		return terminalCommands.release.invoke<void>({ sessionId, terminalId });
	},
};
