import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import * as Result from "effect/Result";
import type { AcpError } from "../errors/index.js";
import { ProtocolError } from "../errors/index.js";
import type { ContentBlock } from "../schemas/content-block.schema.js";
import { ContentBlockSchema } from "../schemas/content-block.schema.js";

/**
 * Safely parse and validate a content block.
 *
 * Uses Effect Schema to avoid throwing exceptions.
 * Returns a Result type for functional error handling.
 *
 * @param data - Unknown data to validate
 * @returns Result containing validated ContentBlock or error
 */
const decodeContentBlock = decodeUnknown(
	ContentBlockSchema,
	(error) => new ProtocolError(`Invalid content block: ${error.message}`, error)
);

export function validateContentBlock(data: unknown): Result.Result<ContentBlock, AcpError> {
	return decodeContentBlock(data);
}

/**
 * Safely parse and validate an array of content blocks.
 *
 * @param data - Unknown data to validate (should be an array)
 * @returns Result containing validated ContentBlock array or error
 */
export function validateContentBlocks(data: unknown): Result.Result<ContentBlock[], AcpError> {
	if (!Array.isArray(data)) {
		return Result.fail(new ProtocolError(`Expected array of content blocks, got ${typeof data}`));
	}

	const validated: ContentBlock[] = [];
	const errors: string[] = [];

	for (let i = 0; i < data.length; i++) {
		const result = validateContentBlock(data[i]);
		if (Result.isSuccess(result)) {
			validated.push(result.success);
		} else {
			errors.push(`Block ${i}: ${result.failure.message}`);
		}
	}

	if (errors.length > 0) {
		return Result.fail(new ProtocolError(`Validation errors: ${errors.join("; ")}`));
	}

	return Result.succeed(validated);
}

/**
 * Extract text content from a content block.
 *
 * Returns the text if the block is a text block, otherwise returns empty string.
 * This is a type-safe helper that uses type narrowing.
 *
 * @param block - Content block to extract text from
 * @returns Extracted text or empty string
 */
export function extractTextFromBlock(block: ContentBlock): string {
	if (block.type === "text") {
		return block.text;
	}
	return "";
}

/**
 * Check if a content block is a text block.
 *
 * Type guard for narrowing ContentBlock to text type.
 *
 * @param block - Content block to check
 * @returns True if block is a text block
 */
export function isTextBlock(block: ContentBlock): block is Extract<ContentBlock, { type: "text" }> {
	return block.type === "text";
}

/**
 * Check if a content block is an image block.
 *
 * @param block - Content block to check
 * @returns True if block is an image block
 */
export function isImageBlock(
	block: ContentBlock
): block is Extract<ContentBlock, { type: "image" }> {
	return block.type === "image";
}

/**
 * Check if a content block is an audio block.
 *
 * @param block - Content block to check
 * @returns True if block is an audio block
 */
export function isAudioBlock(
	block: ContentBlock
): block is Extract<ContentBlock, { type: "audio" }> {
	return block.type === "audio";
}

/**
 * Normalize content blocks from various ACP protocol formats.
 *
 * The ACP protocol may send content in different formats:
 * - Flat format: `[{ type: "text", text: "..." }]`
 * - Nested format: `[{ content: { type: "text", text: "..." }, type: "content" }]`
 *
 * This function normalizes both formats to the flat ContentBlock format
 * that our schemas expect.
 *
 * @param content - Unknown content array to normalize
 * @returns Normalized array ready for ContentBlockSchema validation
 */
export function normalizeContentBlocks(content: unknown): unknown[] {
	if (!Array.isArray(content)) {
		return [];
	}

	return content.map((item) => {
		if (typeof item !== "object" || item === null) {
			return item;
		}

		const obj = item as Record<string, unknown>;

		// Check for nested format: { content: { type, text }, type: "content" }
		if (obj.type === "content" && typeof obj.content === "object" && obj.content !== null) {
			return obj.content;
		}

		// Already in flat format or unknown format - pass through
		return item;
	});
}
