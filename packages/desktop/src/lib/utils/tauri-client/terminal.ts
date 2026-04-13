import type { ResultAsync } from "neverthrow";

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
	create: (request: CreateTerminalParams): ResultAsync<CreateTerminalResult, AppError> => {
		return terminalCommands.create.invoke<CreateTerminalResult>({ request });
	},

	output: (sessionId: string, terminalId: string): ResultAsync<TerminalOutputResult, AppError> => {
		return terminalCommands.output.invoke<TerminalOutputResult>({ sessionId, terminalId });
	},

	waitForExit: (
		sessionId: string,
		terminalId: string
	): ResultAsync<WaitForExitResult, AppError> => {
		return terminalCommands.wait_for_exit.invoke<WaitForExitResult>({ sessionId, terminalId });
	},

	kill: (sessionId: string, terminalId: string): ResultAsync<void, AppError> => {
		return terminalCommands.kill.invoke<void>({ sessionId, terminalId });
	},

	release: (sessionId: string, terminalId: string): ResultAsync<void, AppError> => {
		return terminalCommands.release.invoke<void>({ sessionId, terminalId });
	},
};
