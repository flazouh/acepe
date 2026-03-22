import { z } from "zod";

/**
 * Zod schemas for parsing tool result output.
 *
 * Handles various formats of tool execution results:
 * - Plain string output
 * - Objects with output/stdout/stderr fields
 * - MCP content block arrays: [{"type": "text", "text": "..."}]
 *
 * Note: JSON-stringified values are handled in the parsing logic function,
 * not in the schema transforms, to avoid try-catch blocks.
 */

/**
 * Schema for MCP content block format.
 * Handles arrays like [{"type": "text", "text": "..."}]
 */
const McpContentBlockSchema = z
	.array(
		z.object({
			type: z.string(),
			text: z.string().optional(),
		})
	)
	.transform((blocks) => {
		// Extract text from all text blocks and join them
		const textParts = blocks
			.filter((block) => block.type === "text" && block.text)
			.map((block) => block.text);
		return textParts.length > 0 ? textParts.join("\n") : null;
	});

/**
 * Schema for object results with output fields.
 * Extracts output from output/stdout/stderr fields in priority order.
 */
const ObjectResultSchema = z
	.object({
		output: z.string().optional(),
		stdout: z.string().optional(),
		stderr: z.string().optional(),
	})
	.transform((obj) => {
		return obj.output ?? obj.stdout ?? obj.stderr ?? null;
	});

/**
 * Schema for plain string results.
 */
const StringResultSchema = z.string();

/**
 * Union schema that handles all tool result output variations.
 * Tries MCP content block array first, then object schema, then string schema.
 */
export const ToolResultOutputSchema = z.union([
	McpContentBlockSchema,
	ObjectResultSchema,
	StringResultSchema,
]);

/**
 * Type inferred from the schema.
 */
export type ToolResultOutput = z.infer<typeof ToolResultOutputSchema>;
