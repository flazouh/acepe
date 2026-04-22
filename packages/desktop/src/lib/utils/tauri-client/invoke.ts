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
const pendingInvokes = new Map<string, { cmd: string; start: number; args?: string }>();
type InvokeRuntime = <T>(cmd: string, args?: Parameters<typeof invoke>[1]) => Promise<T>;
let invokeCounter = 0;
const debugInvoke =
	typeof import.meta.env !== "undefined" && import.meta.env?.VITE_DEBUG_INVOKE === "true";

type InvokeErrorValue = Error | string | number | boolean | object | null | undefined;
export type InvokeArgs = Parameters<typeof invoke>[1];

export interface GeneratedCommand<TName extends string> {
	readonly name: TName;
	invoke<TResult>(args?: InvokeArgs): ResultAsync<TResult, AppError>;
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
	(window as unknown as Record<string, unknown>).__PENDING_INVOKES = pendingInvokes;
	(window as unknown as Record<string, unknown>).__DUMP_INVOKES = () => {
		const now = Date.now();
		for (const [id, info] of pendingInvokes) {
			console.warn(`[INVOKE] #${id} ${info.cmd} — pending ${now - info.start}ms`, info.args);
		}
		console.warn(`[INVOKE] Total pending: ${pendingInvokes.size}`);
	};
}

function invokeAsyncWithRuntime<T>(
	runtime: InvokeRuntime,
	cmd: string,
	args?: Parameters<typeof invoke>[1]
): ResultAsync<T, AppError> {
	const invokeId = `invoke-${++invokeCounter}`;
	const start = Date.now();
	const argsStr = debugInvoke && args ? JSON.stringify(args).slice(0, 200) : undefined;

	pendingInvokes.set(invokeId, { cmd, start, args: argsStr });
	if (debugInvoke) console.debug(`[INVOKE] #${invokeId} START ${cmd}`, argsStr ?? "");

	return ResultAsync.fromPromise(
		runtime<T>(cmd, args).finally(() => {
			const elapsed = Date.now() - start;
			pendingInvokes.delete(invokeId);
			if (elapsed > 1000) {
				console.warn(`[INVOKE] #${invokeId} DONE ${cmd} took ${elapsed}ms`);
			} else if (debugInvoke) {
				console.debug(`[INVOKE] #${invokeId} DONE ${cmd} ${elapsed}ms`);
			}
		}),
		(error) => {
			const elapsed = Date.now() - start;
			pendingInvokes.delete(invokeId);
			console.error(`[INVOKE] #${invokeId} FAIL ${cmd} after ${elapsed}ms`, error);

			const invokeError = createInvokeError(
				cmd,
				error as Error | string | number | boolean | object | null | undefined
			);
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

export function createGeneratedCommand<TName extends string>(name: TName): GeneratedCommand<TName> {
	return {
		name,
		invoke<TResult>(args?: InvokeArgs): ResultAsync<TResult, AppError> {
			return invokeAsync<TResult>(name, args);
		},
	};
}

export const invokeAsyncWithRuntimeForTesting = invokeAsyncWithRuntime;
