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

/**
 * Resolve command HTML reactively: prefer precomputed `commandHtmls`, else invoke
 * `highlightCommand` per segment. Returns undefined when highlighting is unavailable
 * so the View can fall back to the lightweight tokenizer.
 *
 * Call from `$derived` so a highlighter that reads a reactive `ready` flag upgrades
 * after the Shiki singleton finishes loading (avoids baking undefined into memoized scene).
 */
export function resolveExecuteCommandHtmls(input: {
	command: string | null;
	commandHtmls?: readonly string[];
	highlightCommand?: ((code: string) => string | null) | null;
}): readonly string[] | undefined {
	if (shouldUseCommandHtmls(input.commandHtmls)) {
		return input.commandHtmls;
	}

	if (!input.command || !input.highlightCommand) {
		return undefined;
	}

	const segments = getExecuteCommandSegments(input.command);
	const highlighted: string[] = [];
	for (const segment of segments) {
		const html = input.highlightCommand(segment);
		if (html === null) {
			return undefined;
		}
		highlighted.push(html);
	}

	return highlighted.length > 0 ? highlighted : undefined;
}

/**
 * Resolve stdout/stderr HTML: prefer a precomputed string, else invoke `highlight`.
 * Returns null when highlighting is unavailable (plain text fallback).
 */
export function resolveExecuteOutputHtml(input: {
	text?: string | null;
	precomputed?: string | null;
	highlight?: ((code: string) => string | null) | null;
}): string | null {
	if (typeof input.precomputed === "string") {
		return input.precomputed;
	}

	if (!input.text || !input.highlight) {
		return null;
	}

	return input.highlight(input.text);
}

const COMPACT_COMMAND_FILE_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".svelte",
	".rs",
	".py",
	".go",
	".json",
	".md",
	".css",
	".html",
	".yaml",
	".yml",
	".toml",
	".test.ts",
	".spec.ts",
	".vitest.ts",
] as const;

function stripCommandTokenQuotes(token: string): string {
	const trimmed = token.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function tokenizeCommandWords(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	for (const character of command) {
		if (quote) {
			if (character === quote) {
				quote = null;
				continue;
			}
			current = current + character;
			continue;
		}

		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}

		if (character === " " || character === "\t") {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current = current + character;
	}

	if (current.length > 0) {
		tokens.push(current);
	}

	return tokens;
}

function looksLikeCompactCommandFilePath(token: string): boolean {
	const value = stripCommandTokenQuotes(token);
	if (!value || value.startsWith("-")) {
		return false;
	}
	if (value.includes("://")) {
		return false;
	}
	if (value.includes("/")) {
		return true;
	}
	for (const extension of COMPACT_COMMAND_FILE_EXTENSIONS) {
		if (value.endsWith(extension)) {
			return true;
		}
	}
	return false;
}

export function extractExecuteCommandFilePath(
	command: string | null | undefined
): string | null {
	if (!command) {
		return null;
	}

	const segments = splitCommandSegments(command);
	const activeSegment = segments.length > 0 ? segments[segments.length - 1] : command;
	const tokens = tokenizeCommandWords(activeSegment);

	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		const token = tokens[index];
		if (!token) {
			continue;
		}
		const candidate = stripCommandTokenQuotes(token);
		if (looksLikeCompactCommandFilePath(candidate)) {
			return candidate;
		}
	}

	return null;
}
