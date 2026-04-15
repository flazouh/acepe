import { err, ok, type Result } from "neverthrow";
import { safeJsonParse } from "../../../../logic/json-utils.js";
import { EXECUTE_TOOL_ERROR_CODES, ExecuteToolError } from "../errors/execute-tool-error.js";
import { ToolResultOutputSchema } from "../schemas/tool-result-output.schema.js";

/**
 * Parsed result with stdout, stderr, and exit code (like 1code).
 */
export interface ParsedToolResult {
	stdout: string | null;
	stderr: string | null;
	exitCode: number | undefined;
}

interface NormalizedExecEnvelope {
	output: string;
	exitCode: number | undefined;
}

function normalizeExecEnvelope(raw: string): NormalizedExecEnvelope {
	const outputMarker = /(?:^|\n)Output:\r?\n/;
	const markerMatch = outputMarker.exec(raw);
	if (!markerMatch) {
		const shellExitMatch = /(?:\r?\n)?<exited with exit code (-?\d+)>\s*$/i.exec(raw);
		if (!shellExitMatch || shellExitMatch.index === undefined) {
			return { output: raw, exitCode: undefined };
		}

		const parsedExitCode = Number(shellExitMatch[1]);
		const outputWithoutExitMarker = raw
			.slice(0, shellExitMatch.index)
			.replace(/\r?\n$/, "");

		return {
			output: outputWithoutExitMarker,
			exitCode: Number.isFinite(parsedExitCode) ? parsedExitCode : undefined,
		};
	}

	const header = raw.slice(0, markerMatch.index + markerMatch[0].length);
	const output = raw.slice(markerMatch.index + markerMatch[0].length);
	const exitCodeMatch = /Process exited with code\s+(-?\d+)/i.exec(header);
	const parsedExitCode =
		exitCodeMatch && Number.isFinite(Number(exitCodeMatch[1]))
			? Number(exitCodeMatch[1])
			: undefined;

	return { output, exitCode: parsedExitCode };
}

/**
 * Parses tool result to extract stdout, stderr, and exit code separately.
 * Matches 1code's behavior for bash tool output display.
 *
 * @param result - Unknown tool result to parse
 * @returns Parsed result with stdout, stderr, and exitCode
 */
export function parseToolResultWithExitCode(result: unknown): ParsedToolResult {
	function fallbackStdout(value: unknown): string | null {
		const fallbackResult = parseToolResultOutput(value);
		if (fallbackResult.isErr()) {
			return null;
		}

		return fallbackResult.value;
	}

	// Handle null/undefined early
	if (result === null || result === undefined) {
		return { stdout: null, stderr: null, exitCode: undefined };
	}

	// If result is an object, extract fields directly
	if (typeof result === "object" && !Array.isArray(result)) {
		const obj = result as Record<string, unknown>;

		// Extract stdout (check output first, then stdout)
		let stdout: string | null = null;
		let envelopeExitCode: number | undefined;
		if (typeof obj.output === "string") {
			const normalized = normalizeExecEnvelope(obj.output);
			stdout = normalized.output;
			envelopeExitCode = normalized.exitCode;
		} else if (typeof obj.stdout === "string") {
			const normalized = normalizeExecEnvelope(obj.stdout);
			stdout = normalized.output;
			envelopeExitCode = normalized.exitCode;
		} else if (typeof obj.detailedContent === "string") {
			const normalized = normalizeExecEnvelope(obj.detailedContent);
			stdout = normalized.output;
			envelopeExitCode = normalized.exitCode;
		} else if (typeof obj.content === "string") {
			const normalized = normalizeExecEnvelope(obj.content);
			stdout = normalized.output;
			envelopeExitCode = normalized.exitCode;
		}

		// Extract stderr
		let stderr: string | null = null;
		if (typeof obj.stderr === "string") {
			stderr = obj.stderr;
		}

		// Extract exit code (check exitCode and exit_code)
		let exitCode: number | undefined;
		if (typeof obj.exitCode === "number") {
			exitCode = obj.exitCode;
		} else if (typeof obj.exit_code === "number") {
			exitCode = obj.exit_code;
		} else {
			exitCode = envelopeExitCode;
		}

		if (stdout === null && stderr === null) {
			return {
				stdout: fallbackStdout(result),
				stderr,
				exitCode,
			};
		}

		return { stdout, stderr, exitCode };
	}

	// If result is a string, treat it as stdout
	if (typeof result === "string") {
		const normalized = normalizeExecEnvelope(result);
		return {
			stdout: normalized.output,
			stderr: null,
			exitCode: normalized.exitCode,
		};
	}

	return {
		stdout: fallbackStdout(result),
		stderr: null,
		exitCode: undefined,
	};
}

/**
 * Parses tool result output from various formats.
 *
 * Handles:
 * - Plain string results
 * - JSON-stringified strings
 * - Objects with output/stdout/stderr fields
 * - Nested JSON-stringified values
 *
 * Uses Zod schemas and safeJsonParse to avoid try-catch blocks.
 *
 * @param result - Unknown tool result to parse
 * @returns Result containing parsed string output or null, or an error
 */
export function parseToolResultOutput(result: unknown): Result<string | null, ExecuteToolError> {
	// Handle null/undefined early
	if (result === null || result === undefined) {
		return ok(null);
	}

	// Use Zod schema to validate and extract structure
	const schemaResult = ToolResultOutputSchema.safeParse(result);

	if (!schemaResult.success) {
		return err(
			new ExecuteToolError(
				`Failed to parse tool result: ${schemaResult.error.message}`,
				EXECUTE_TOOL_ERROR_CODES.PARSE_RESULT_FAILED,
				schemaResult.error
			)
		);
	}

	const parsed = schemaResult.data;

	// If result is null (from object with no output fields), return null
	if (parsed === null) {
		return ok(null);
	}

	// If result is a string, try to parse it as JSON
	if (typeof parsed === "string") {
		const normalized = normalizeExecEnvelope(parsed);
		const normalizedOutput = normalized.output;

		// Try to parse as JSON-stringified string
		const jsonParseResult = safeJsonParse<unknown>(normalizedOutput);

		if (jsonParseResult.isOk()) {
			const parsedValue = jsonParseResult.value;
			// If successfully parsed and result is a string, return it
			if (typeof parsedValue === "string") {
				return ok(parsedValue);
			}
		}

		// If JSON parsing failed or result is not a string, return original
		return ok(normalizedOutput);
	}

	// This should not happen based on schema, but handle it
	return ok(null);
}
