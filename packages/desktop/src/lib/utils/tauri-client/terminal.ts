import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type {
	CreateTerminalParams,
	CreateTerminalResult,
	TerminalOutputResult,
	WaitForExitResult,
} from "../../acp/types/index.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const terminal = {
	create: (request: CreateTerminalParams): ResultAsync<CreateTerminalResult, AppError> => {
		return invokeAsync(CMD.terminal.create, { request });
	},

	output: (sessionId: string, terminalId: string): ResultAsync<TerminalOutputResult, AppError> => {
		return invokeAsync(CMD.terminal.output, { sessionId, terminalId });
	},

	waitForExit: (
		sessionId: string,
		terminalId: string
	): ResultAsync<WaitForExitResult, AppError> => {
		return invokeAsync(CMD.terminal.wait_for_exit, { sessionId, terminalId });
	},

	kill: (sessionId: string, terminalId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.terminal.kill, { sessionId, terminalId });
	},

	release: (sessionId: string, terminalId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.terminal.release, { sessionId, terminalId });
	},
};
