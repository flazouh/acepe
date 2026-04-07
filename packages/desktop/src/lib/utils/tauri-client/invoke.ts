import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { tryDeserializeAcpError } from "../../acp/errors/index.js";

import { AgentError } from "../../acp/errors/app-error.js";

// DEBUG: Track all in-flight Tauri IPC calls
const pendingInvokes = new Map<number, { cmd: string; start: number; args?: string }>();
let invokeCounter = 0;
const debugInvoke =
	typeof import.meta.env !== "undefined" && import.meta.env?.VITE_DEBUG_INVOKE === "true";

type InvokeErrorValue = Error | string | number | boolean | object | null | undefined;

function normalizeInvokeError(error: InvokeErrorValue): Error {
	if (error instanceof Error) {
		return error;
	}

	const acpError = tryDeserializeAcpError(error);
	if (acpError !== null) {
		return acpError;
	}

	if (error && typeof error === "object" && "message" in error) {
		const message = error.message;
		if (typeof message === "string" && message.trim().length > 0) {
			return new Error(message);
		}
	}

	return new Error(String(error));
}

// Expose for console debugging
if (typeof window !== "undefined") {
	(window as unknown as Record<string, unknown>).__PENDING_INVOKES = pendingInvokes;
	(window as unknown as Record<string, unknown>).__DUMP_INVOKES = () => {
		const now = Date.now();
		for (const [id, info] of pendingInvokes) {
			console.warn(`[INVOKE] #${id} ${info.cmd} — pending ${now - info.start}ms`, info.args);
		}
		console.warn(`[INVOKE] Total pending: ${pendingInvokes.size}`);
	};
}

/**
 * Wrap Tauri invoke with ResultAsync for consistent error handling.
 */
export function invokeAsync<T>(
	cmd: string,
	args?: Record<string, unknown>
): ResultAsync<T, AppError> {
	const id = ++invokeCounter;
	const start = Date.now();
	const argsStr = args ? JSON.stringify(args).slice(0, 200) : undefined;

	pendingInvokes.set(id, { cmd, start, args: argsStr });
	if (debugInvoke) console.debug(`[INVOKE] #${id} START ${cmd}`, argsStr ?? "");

	return ResultAsync.fromPromise(
		invoke<T>(cmd, args).finally(() => {
			const elapsed = Date.now() - start;
			pendingInvokes.delete(id);
			if (elapsed > 1000) {
				console.warn(`[INVOKE] #${id} DONE ${cmd} took ${elapsed}ms`);
			} else if (debugInvoke) {
				console.debug(`[INVOKE] #${id} DONE ${cmd} ${elapsed}ms`);
			}
		}),
		(error) => {
			const elapsed = Date.now() - start;
			pendingInvokes.delete(id);
			console.error(`[INVOKE] #${id} FAIL ${cmd} after ${elapsed}ms`, error);
			return new AgentError(
				cmd,
				normalizeInvokeError(error as Error | string | number | boolean | object | null | undefined)
			);
		}
	);
}
