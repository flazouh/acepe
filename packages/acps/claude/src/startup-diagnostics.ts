export type StartupEntrypoint = "index" | "static-entry";
export type StartupMode = "acp" | "cli";

type StartupFailureObject = {
	__acepeStartupFailureLogged?: boolean;
	name?: string;
	message?: string;
	stack?: string;
};

export type StartupFailure =
	| Error
	| StartupFailureObject
	| string
	| number
	| boolean
	| null
	| undefined;

export type StartupFailureContext = {
	entrypoint: StartupEntrypoint;
	mode: StartupMode;
	stage: string;
	argv: readonly string[];
	cwd: string;
	execPath: string;
	platform: NodeJS.Platform;
	arch: string;
	runtimeVersion: string;
	bunVersion: string | undefined;
	singleFileBun: boolean;
};

function getFailureObject(failure: StartupFailure): StartupFailureObject | null {
	if (failure && typeof failure === "object") {
		return failure as StartupFailureObject;
	}
	return null;
}

function formatFailureSummary(failure: StartupFailure): string {
	if (failure instanceof Error) {
		return `${failure.name}: ${failure.message}`;
	}

	if (typeof failure === "string") {
		return failure;
	}

	if (typeof failure === "number" || typeof failure === "boolean") {
		return String(failure);
	}

	if (failure === null) {
		return "null";
	}

	if (failure === undefined) {
		return "undefined";
	}

	const failureObject = getFailureObject(failure);
	if (!failureObject) {
		return "unknown startup failure";
	}

	const failureName = failureObject.name;
	const failureMessage = failureObject.message;

	if (failureName && failureMessage) {
		return `${failureName}: ${failureMessage}`;
	}

	if (failureName) {
		return failureName;
	}

	if (failureMessage) {
		return failureMessage;
	}

	return "non-Error object failure";
}

function formatFailureStack(failure: StartupFailure): string | null {
	if (failure instanceof Error && failure.stack) {
		return failure.stack;
	}

	const failureObject = getFailureObject(failure);
	if (failureObject?.stack) {
		return failureObject.stack;
	}

	return null;
}

export function shouldLogStartupFailure(failure: StartupFailure): boolean {
	const failureObject = getFailureObject(failure);
	if (!failureObject) {
		return true;
	}

	return failureObject.__acepeStartupFailureLogged !== true;
}

export function markStartupFailureLogged(failure: StartupFailure): void {
	const failureObject = getFailureObject(failure);
	if (failureObject) {
		failureObject.__acepeStartupFailureLogged = true;
	}
}

export function collectStartupFailureContext(
	entrypoint: StartupEntrypoint,
	mode: StartupMode,
	stage: string
): StartupFailureContext {
	return {
		entrypoint,
		mode,
		stage,
		argv: [...process.argv],
		cwd: process.cwd(),
		execPath: process.execPath,
		platform: process.platform,
		arch: process.arch,
		runtimeVersion: process.version,
		bunVersion: process.versions.bun,
		singleFileBun: process.env.CLAUDE_AGENT_ACP_IS_SINGLE_FILE_BUN === "true",
	};
}

export function formatStartupFailureReport(
	context: StartupFailureContext,
	failure: StartupFailure
): string {
	const lines = [
		"[acepe-claude-startup]",
		`entrypoint=${context.entrypoint}`,
		`mode=${context.mode}`,
		`stage=${context.stage}`,
		`platform=${context.platform}`,
		`arch=${context.arch}`,
		`runtime=${context.runtimeVersion}`,
		`bun=${context.bunVersion ?? "not-bun"}`,
		`singleFileBun=${context.singleFileBun}`,
		`cwd=${context.cwd}`,
		`execPath=${context.execPath}`,
		`argv=${JSON.stringify([...context.argv])}`,
		`error=${formatFailureSummary(failure)}`,
	];

	const failureStack = formatFailureStack(failure);
	if (failureStack) {
		lines.push("stack=");
		lines.push(failureStack);
	}

	return lines.join("\n");
}

export function logStartupFailure(
	context: StartupFailureContext,
	failure: StartupFailure
): void {
	if (!shouldLogStartupFailure(failure)) {
		return;
	}

	markStartupFailureLogged(failure);
	console.error(formatStartupFailureReport(context, failure));
}
