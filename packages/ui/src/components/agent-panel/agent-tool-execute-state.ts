import {
	highlightBashSegment,
	splitCommandSegments,
} from "../../lib/bash-tokenizer.js";
import type { AgentToolStatus } from "./types.js";

export type ExecuteStderrColorClass =
	| "execute-stderr-warn"
	| "execute-stderr-err";

export function isExecutePending(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

export function isExecuteSuccess(exitCode?: number): boolean {
	return exitCode === 0;
}

export function isExecuteError(exitCode?: number): boolean {
	return exitCode !== undefined && exitCode !== 0;
}

export function hasExecuteOutput(input: {
	stdout?: string | null;
	stderr?: string | null;
	stdoutHtml?: string | null;
	stderrHtml?: string | null;
}): boolean {
	return Boolean(input.stdout || input.stderr || input.stdoutHtml || input.stderrHtml);
}

export function getExecuteHeaderText(input: {
	status: AgentToolStatus;
	runningLabel: string;
	finishedLabel: string;
}): string {
	if (isExecutePending(input.status)) {
		return input.runningLabel;
	}
	if (input.status === "blocked") return "Waiting for permission";
	if (input.status === "degraded") return "Degraded";
	if (input.status === "cancelled") return "Cancelled";
	if (input.status === "error") return "Command failed";
	return input.finishedLabel;
}

export function getExecuteCommandSegments(command: string | null): readonly string[] {
	return command ? splitCommandSegments(command) : [];
}

export function getFallbackCommandHtmls(
	segments: readonly string[]
): readonly string[] {
	return segments.map((segment) => highlightBashSegment(segment));
}

export function shouldUseCommandHtmls(
	commandHtmls?: readonly string[]
): boolean {
	return commandHtmls !== undefined && commandHtmls.length > 0;
}

export function getExecuteDisplayHtmls(input: {
	commandHtmls?: readonly string[];
	fallbackHtmls: readonly string[];
}): readonly string[] {
	return shouldUseCommandHtmls(input.commandHtmls)
		? input.commandHtmls!
		: input.fallbackHtmls;
}

export function getExecuteStderrColor(
	exitCode?: number
): ExecuteStderrColorClass {
	return exitCode === 0 || exitCode === undefined
		? "execute-stderr-warn"
		: "execute-stderr-err";
}

export function shouldUseOutputHtml(outputHtml?: string | null): boolean {
	return typeof outputHtml === "string";
}
