import type * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import type {
	CreateTerminalParams,
	CreateTerminalResult,
	TerminalOutputResult,
	WaitForExitResult,
} from "../../acp/types/index.js";
import { unsupportedOnContract } from "./rpc-bridge.ts";

// This facade wraps the ACP protocol's terminal/create, terminal/output,
// terminal/wait_for_exit, terminal/kill and terminal/release methods (see
// ACP_METHODS.TERMINAL_CREATE and friends in
// ../../acp/constants/acp-methods.ts): an agent-initiated request to run a
// command and capture its output, distinct from the interactive PTY terminal
// in the session panel (which rides the contract's terminal.open/input/
// resize/close commands and the "terminal" snapshot kind today, see
// agent-panel-terminal-store.ts). No ACP method dispatch table in this
// codebase routes those method names anywhere, so every export here has zero
// live callers (verified by grep across packages/desktop/src). The contract
// has no equivalent "run and capture" terminal concept yet, so these stay on
// unsupportedOnContract rather than being half-wired onto the PTY primitives,
// which model a different capability (#249 batch 2).
export const terminal = {
	create: (_request: CreateTerminalParams): Effect.Effect<CreateTerminalResult, AppError> =>
		unsupportedOnContract("terminal.create"),

	output: (
		_sessionId: string,
		_terminalId: string
	): Effect.Effect<TerminalOutputResult, AppError> => unsupportedOnContract("terminal.output"),

	waitForExit: (
		_sessionId: string,
		_terminalId: string
	): Effect.Effect<WaitForExitResult, AppError> => unsupportedOnContract("terminal.waitForExit"),

	kill: (_sessionId: string, _terminalId: string): Effect.Effect<void, AppError> =>
		unsupportedOnContract("terminal.kill"),

	release: (_sessionId: string, _terminalId: string): Effect.Effect<void, AppError> =>
		unsupportedOnContract("terminal.release"),
};
