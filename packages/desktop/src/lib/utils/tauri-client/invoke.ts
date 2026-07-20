import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { AgentError } from "../../acp/errors/app-error.js";
import { tryDeserializeAcpError } from "../../acp/errors/index.js";
import {
	attachErrorReference,
	createLocalReferenceDetails,
	findErrorReference,
} from "../../errors/error-reference.js";
import {
	type CommandErrorClassification,
	parseSerializableCommandError,
	type SerializableCommandError,
} from "./serializable-command-error.schema.js";

// DEBUG: Track all in-flight Tauri IPC calls
type PendingInvokeInfo = {
	readonly cmd: string;
	readonly start: number;
	readonly argsSummary: string | null;
	readonly args?: string;
};

const pendingInvokes = new Map<string, PendingInvokeInfo>();
type InvokeRuntime = <T>(cmd: string, args?: Parameters<typeof invoke>[1]) => Promise<T>;
let invokeCounter = 0;
const debugInvoke =
	typeof import.meta.env !== "undefined" && import.meta.env?.VITE_DEBUG_INVOKE === "true";
const MAX_COMPLETED_INVOKE_TIMINGS = 300;

type InvokeErrorValue = Error | string | number | boolean | object | null | undefined;
export type InvokeArgs = Parameters<typeof invoke>[1];
export type TauriInvokeTimingStatus = "ok" | "error";

export interface TauriInvokeTimingRecord {
	readonly id: string;
	readonly command: string;
	readonly argsSummary: string | null;
	readonly startedAtMs: number;
	readonly completedAtMs: number;
	readonly durationMs: number;
	readonly status: TauriInvokeTimingStatus;
}

export interface TauriPendingInvokeRecord {
	readonly id: string;
	readonly command: string;
	readonly argsSummary: string | null;
	readonly startedAtMs: number;
	readonly elapsedMs: number;
}

declare global {
	interface Window {
		__ACEPE_GET_INVOKE_TIMINGS__?: () => TauriInvokeTimingRecord[];
		__PENDING_INVOKES?: typeof pendingInvokes;
		__DUMP_INVOKES?: () => void;
	}
}

const completedInvokeTimings: TauriInvokeTimingRecord[] = [];

export interface GeneratedCommand<TName extends string> {
	readonly name: TName;
	invoke<TResult>(args?: InvokeArgs): ResultAsync<TResult, AppError>;
}

interface InvokeOptions {
	readonly reportFailure: boolean;
}

const DEFAULT_INVOKE_OPTIONS: InvokeOptions = {
	reportFailure: true,
};

function nowMs(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function copyInvokeTimingRecord(record: TauriInvokeTimingRecord): TauriInvokeTimingRecord {
	return {
		id: record.id,
		command: record.command,
		argsSummary: record.argsSummary,
		startedAtMs: record.startedAtMs,
		completedAtMs: record.completedAtMs,
		durationMs: record.durationMs,
		status: record.status,
	};
}

function summarizeInvokeArgs(command: string, args?: InvokeArgs): string | null {
	if (
		command !== "get_user_settings" ||
		args === undefined ||
		args === null ||
		typeof args !== "object" ||
		Array.isArray(args)
	) {
		return null;
	}

	const settingsArgs = args as { readonly keys?: readonly string[] };
	if (!Array.isArray(settingsArgs.keys)) {
		return null;
	}

	const keys: string[] = [];
	for (const key of settingsArgs.keys) {
		if (typeof key === "string") {
			keys.push(key);
		}
	}
	return keys.length === 0 ? null : keys.join(",");
}

function recordCompletedInvokeTiming(
	id: string,
	command: string,
	argsSummary: string | null,
	startedAtMs: number,
	status: TauriInvokeTimingStatus
): TauriInvokeTimingRecord {
	const completedAtMs = nowMs();
	const record: TauriInvokeTimingRecord = {
		id,
		command,
		argsSummary,
		startedAtMs: roundMs(startedAtMs),
		completedAtMs: roundMs(completedAtMs),
		durationMs: roundMs(completedAtMs - startedAtMs),
		status,
	};
	completedInvokeTimings.push(record);
	if (completedInvokeTimings.length > MAX_COMPLETED_INVOKE_TIMINGS) {
		completedInvokeTimings.splice(0, completedInvokeTimings.length - MAX_COMPLETED_INVOKE_TIMINGS);
	}
	return record;
}

export function getTauriInvokeTimings(): TauriInvokeTimingRecord[] {
	return completedInvokeTimings.map(copyInvokeTimingRecord);
}

export function getPendingTauriInvokes(): TauriPendingInvokeRecord[] {
	const now = nowMs();
	const records: TauriPendingInvokeRecord[] = [];
	for (const [id, info] of pendingInvokes) {
		records.push({
			id,
			command: info.cmd,
			argsSummary: info.argsSummary,
			startedAtMs: roundMs(info.start),
			elapsedMs: roundMs(now - info.start),
		});
	}
	return records;
}

export function resetTauriInvokeTimingsForTesting(): void {
	completedInvokeTimings.length = 0;
}

export class TauriCommandError extends AgentError {
	readonly classification: CommandErrorClassification;
	readonly backendCorrelationId: string;
	readonly backendEventId: string | undefined;
	readonly diagnosticsSummary: string | undefined;
	readonly domain: SerializableCommandError["domain"];
	readonly referenceId: string;
	readonly referenceSearchable: boolean;

	constructor(commandError: SerializableCommandError) {
		super(commandError.commandName, resolveCommandErrorCause(commandError));
		this.name = "TauriCommandError";
		this.message = commandError.message;
		this.classification = commandError.classification;
		this.backendCorrelationId = commandError.backendCorrelationId;
		this.backendEventId = commandError.backendEventId;
		this.diagnosticsSummary = commandError.diagnostics?.summary;
		this.domain = commandError.domain;
		this.referenceId = commandError.backendCorrelationId;
		this.referenceSearchable = commandError.backendEventId !== undefined;
	}
}

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

function resolveCommandErrorCause(commandError: SerializableCommandError): Error {
	if (commandError.domain?.type === "acp") {
		const acpError = tryDeserializeAcpError(commandError.domain.data);
		if (acpError !== null) {
			return acpError;
		}
	}

	return new Error(commandError.message);
}

function createInvokeError(cmd: string, error: InvokeErrorValue): AgentError {
	const commandError = parseSerializableCommandError(error);
	if (commandError !== null) {
		return new TauriCommandError(commandError);
	}

	return attachErrorReference(
		new AgentError(cmd, normalizeInvokeError(error)),
		createLocalReferenceDetails()
	);
}

function reportCommandFailure(
	error: AgentError,
	context: {
		commandName: string;
		invokeId: string;
		elapsedMs: number;
		referenceId: string;
		referenceSearchable: boolean;
		classification?: CommandErrorClassification;
		backendCorrelationId?: string;
		backendEventId?: string;
		diagnosticsSummary?: string;
	}
): void {
	void import("../../analytics.js")
		.then(({ captureCommandFailure }) => {
			captureCommandFailure(error, context);
		})
		.catch(() => undefined);
}

// Expose for console debugging
if (typeof window !== "undefined" && debugInvoke) {
	window.__PENDING_INVOKES = pendingInvokes;
	window.__DUMP_INVOKES = () => {
		const now = nowMs();
		for (const [id, info] of pendingInvokes) {
			console.warn(`[INVOKE] #${id} ${info.cmd} — pending ${now - info.start}ms`, info.args);
		}
		console.warn(`[INVOKE] Total pending: ${pendingInvokes.size}`);
	};
}

if (
	typeof window !== "undefined" &&
	typeof import.meta.env !== "undefined" &&
	import.meta.env.DEV
) {
	window.__ACEPE_GET_INVOKE_TIMINGS__ = getTauriInvokeTimings;
}

function invokeAsyncWithRuntime<T>(
	runtime: InvokeRuntime,
	cmd: string,
	args?: Parameters<typeof invoke>[1],
	options: InvokeOptions = DEFAULT_INVOKE_OPTIONS
): ResultAsync<T, AppError> {
	const invokeId = `invoke-${++invokeCounter}`;
	const start = nowMs();
	const argsStr = debugInvoke && args ? JSON.stringify(args).slice(0, 200) : undefined;
	const argsSummary = summarizeInvokeArgs(cmd, args);

	pendingInvokes.set(invokeId, { cmd, start, argsSummary, args: argsStr });
	if (debugInvoke) console.debug(`[INVOKE] #${invokeId} START ${cmd}`, argsStr ?? "");

	return ResultAsync.fromPromise(
		runtime<T>(cmd, args).then(
			(value) => {
				const record = recordCompletedInvokeTiming(invokeId, cmd, argsSummary, start, "ok");
				pendingInvokes.delete(invokeId);
				if (record.durationMs > 1000) {
					console.warn(`[INVOKE] #${invokeId} DONE ${cmd} took ${record.durationMs}ms`);
				} else if (debugInvoke) {
					console.debug(`[INVOKE] #${invokeId} DONE ${cmd} ${record.durationMs}ms`);
				}
				return value;
			},
			(error: InvokeErrorValue) => {
				const record = recordCompletedInvokeTiming(invokeId, cmd, argsSummary, start, "error");
				pendingInvokes.delete(invokeId);
				if (debugInvoke) {
					console.debug(`[INVOKE] #${invokeId} FAILED ${cmd} ${record.durationMs}ms`);
				}
				throw error;
			}
		),
		(error) => {
			const elapsed = roundMs(nowMs() - start);
			pendingInvokes.delete(invokeId);
			console.error(`[INVOKE] #${invokeId} FAIL ${cmd} after ${elapsed}ms`, error);

			const invokeError = createInvokeError(
				cmd,
				error as Error | string | number | boolean | object | null | undefined
			);
			if (options.reportFailure) {
				reportCommandFailure(invokeError, {
					commandName: invokeError.operation,
					invokeId,
					elapsedMs: elapsed,
					referenceId:
						invokeError instanceof TauriCommandError
							? invokeError.referenceId
							: (findErrorReference(invokeError)?.referenceId ?? invokeId),
					referenceSearchable:
						invokeError instanceof TauriCommandError
							? invokeError.referenceSearchable
							: (findErrorReference(invokeError)?.searchable ?? false),
					classification:
						invokeError instanceof TauriCommandError ? invokeError.classification : "unexpected",
					backendCorrelationId:
						invokeError instanceof TauriCommandError ? invokeError.backendCorrelationId : undefined,
					backendEventId:
						invokeError instanceof TauriCommandError ? invokeError.backendEventId : undefined,
					diagnosticsSummary:
						invokeError instanceof TauriCommandError ? invokeError.diagnosticsSummary : undefined,
				});
			}

			return invokeError;
		}
	);
}

/**
 * Wrap Tauri invoke with ResultAsync for consistent error handling.
 */
export function invokeAsync<T>(
	cmd: string,
	args?: Parameters<typeof invoke>[1]
): ResultAsync<T, AppError> {
	return invokeAsyncWithRuntime(invoke, cmd, args);
}

export function invokeAsyncQuiet<T>(
	cmd: string,
	args?: Parameters<typeof invoke>[1]
): ResultAsync<T, AppError> {
	return invokeAsyncWithRuntime(invoke, cmd, args, { reportFailure: false });
}

export function createGeneratedCommand<TName extends string>(name: TName): GeneratedCommand<TName> {
	return {
		name,
		invoke<TResult>(args?: InvokeArgs): ResultAsync<TResult, AppError> {
			return invokeAsync<TResult>(name, args);
		},
	};
}

export const invokeAsyncWithRuntimeForTesting = invokeAsyncWithRuntime;
