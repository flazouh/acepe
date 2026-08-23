import type * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { unsupportedOnContract, withRpcClient } from "./rpc-bridge.ts";

export const shell = {
	// Debug-only affordance to reveal a session's raw jsonl transcript in the
	// file manager. Has no live caller today (see #249 batch 2) and depends on
	// jsonl-root/slug resolution that has not been ported to the server yet.
	openInFinder: (_sessionId: string, _projectPath: string): Effect.Effect<void, AppError> =>
		unsupportedOnContract("shell.openInFinder"),

	// Dev-only streaming log inspection tooling from the Tauri build; the
	// Electrobun/Effect server has no equivalent concept yet and this has no
	// live caller today.
	openStreamingLog: (_sessionId: string): Effect.Effect<void, AppError> =>
		unsupportedOnContract("shell.openStreamingLog"),

	getStreamingLogPath: (_sessionId: string): Effect.Effect<string, AppError> =>
		unsupportedOnContract("shell.getStreamingLogPath"),

	getSessionFilePath: (_sessionId: string, _projectPath: string): Effect.Effect<string, AppError> =>
		unsupportedOnContract("shell.getSessionFilePath"),

	getDefaultShell: (): Effect.Effect<string, AppError> =>
		withRpcClient("shell.getDefaultShell", (client) => client.getDefaultShell()),
};
