import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Schemas for parsing tool result output.
 *
 * Handles various formats of tool execution results:
 * - Plain string output
 * - Objects with output/stdout/stderr fields
 * - MCP content block arrays: [{"type": "text", "text": "..."}]
 *
 * Note: JSON-stringified values are handled in the parsing logic function,
 * not in the schema transforms, to avoid try-catch blocks.
 */

const McpContentBlockSchema = Schema.Array(
	Schema.Struct({
		type: Schema.String,
		text: Schema.optionalKey(Schema.String),
	})
);

const ObjectResultSchema = Schema.Struct({
	output: Schema.optionalKey(Schema.String),
	stdout: Schema.optionalKey(Schema.String),
	stderr: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(Schema.String),
	detailedContent: Schema.optionalKey(Schema.String),
});

const StringResultSchema = Schema.String;

export const ToolResultOutputSchema = Schema.Union([
	McpContentBlockSchema,
	ObjectResultSchema,
	StringResultSchema,
]);

export type ToolResultOutput = typeof ToolResultOutputSchema.Type;

const decodeToolResultOutput = decodeUnknown(ToolResultOutputSchema, (error) => error);

function extractMcpText(
	blocks: ReadonlyArray<{ readonly type: string; readonly text?: string }>
): string | null {
	const textParts: string[] = [];
	for (const block of blocks) {
		if (block.type === "text" && block.text) {
			textParts.push(block.text);
		}
	}
	return textParts.length > 0 ? textParts.join("\n") : null;
}

function extractObjectOutput(obj: typeof ObjectResultSchema.Type): string | null {
	return obj.output ?? obj.stdout ?? obj.detailedContent ?? obj.content ?? obj.stderr ?? null;
}

function isMcpContentBlocks(
	value: ToolResultOutput
): value is typeof McpContentBlockSchema.Type {
	return Array.isArray(value);
}

export function parseToolResultOutputValue(value: unknown): Result.Result<string | null, Schema.SchemaError> {
	const decoded = decodeToolResultOutput(value);
	if (Result.isFailure(decoded)) {
		return Result.fail(decoded.failure);
	}

	const parsed = decoded.success;
	if (typeof parsed === "string") {
		return Result.succeed(parsed);
	}
	if (isMcpContentBlocks(parsed)) {
		return Result.succeed(extractMcpText(parsed));
	}
	return Result.succeed(extractObjectOutput(parsed));
}
