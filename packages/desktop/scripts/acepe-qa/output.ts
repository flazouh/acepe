import type { QaCommandResult, QaError, QaStatus } from "./schemas";

export type OutputFormat = "text" | "json";

export type BuildResultInput = {
	readonly command: string;
	readonly status: QaStatus;
	readonly summary: readonly string[];
	readonly artifactPath?: string;
	readonly artifactKind?: string;
	readonly error?: QaError;
};

export function buildResult(input: BuildResultInput): QaCommandResult {
	const artifact =
		input.artifactPath === undefined || input.artifactKind === undefined
			? undefined
			: {
					path: input.artifactPath,
					kind: input.artifactKind,
				};
	return {
		command: input.command,
		status: input.status,
		summary: Array.from(input.summary),
		artifact,
		error: input.error,
	};
}

export function formatCommandResult(result: QaCommandResult, format: OutputFormat): string {
	if (format === "json") {
		return `${JSON.stringify(result, null, 2)}\n`;
	}

	const lines = [`${result.command}: ${result.status}`];
	for (const line of result.summary) {
		lines.push(`- ${line}`);
	}
	if (result.artifact !== undefined) {
		lines.push(`- artifact: ${result.artifact.path}`);
	}
	if (result.error !== undefined) {
		lines.push(`- error: ${result.error.code}: ${result.error.message}`);
		if (result.error.nextStep !== undefined) {
			lines.push(`- next: ${result.error.nextStep}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

export function statusExitCode(status: QaStatus): number {
	return status === "fail" ? 1 : 0;
}

export function dependencyError(code: string, message: string, nextStep: string): QaError {
	return {
		code,
		message,
		nextStep,
	};
}
