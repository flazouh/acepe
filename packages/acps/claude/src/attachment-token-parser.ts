/**
 * Attachment Token Parser
 *
 * Parses attachment tokens in message text and expands them inline.
 * Attachment tokens follow the format: @[type:value]
 * Where type is "file", "image", or "text" and value is:
 * - For file/image: the file path
 * - For text: base64-encoded content
 *
 * This module decodes text tokens so Claude sees actual content instead of base64 hashes.
 */

/**
 * Regex pattern to match attachment tokens.
 * Matches @[type:value] where type is "file", "image", "text", "command", or "skill"
 * and value can contain any characters except ]
 */
const ATTACHMENT_TOKEN_REGEX = /@\[(file|image|text|command|skill):([^\]]+)\]/g;

/**
 * Represents a parsed attachment from a message.
 */
export interface ParsedAttachment {
	/** Type of attachment: "file", "image", "text", "command", or "skill" */
	type: "file" | "image" | "text" | "command" | "skill";
	/** For file/image: the path. For text: empty */
	path: string;
	/** Decoded text content (only for text attachments) */
	content?: string;
}

/**
 * Result of parsing and expanding attachment tokens.
 */
export interface ExpandedPromptResult {
	/** The text with attachment tokens expanded inline */
	expandedText: string;
	/** Array of parsed attachments (for reference) */
	attachments: ParsedAttachment[];
}

/**
 * Decodes a base64-encoded string to UTF-8 text.
 * Handles the encodeURIComponent(escape()) encoding used by the frontend.
 */
function decodeBase64Content(base64: string): string | null {
	try {
		// The frontend uses: btoa(unescape(encodeURIComponent(content)))
		// So we reverse: decodeURIComponent(escape(atob(base64)))
		const decoded = Buffer.from(base64, "base64").toString("utf-8");
		return decoded;
	} catch {
		return null;
	}
}

/**
 * Expands attachment tokens in text, replacing text tokens with their decoded content.
 *
 * @param text - The input text potentially containing attachment tokens
 * @returns Object containing expanded text and parsed attachments
 *
 * @example
 * Input: "@[text:SGVsbG8gV29ybGQ=]\nPlease review this"
 * Output: {
 *   expandedText: "--- Pasted Content ---\nHello World\n---\nPlease review this",
 *   attachments: [{ type: "text", path: "", content: "Hello World" }]
 * }
 */
export function expandAttachmentTokens(text: string): ExpandedPromptResult {
	const attachments: ParsedAttachment[] = [];
	let expandedText = text;

	// Find all matches first to collect attachment info
	const matches = [...text.matchAll(ATTACHMENT_TOKEN_REGEX)];

	for (const match of matches) {
		const fullMatch = match[0];
		const type = match[1] as "file" | "image" | "text" | "command" | "skill";
		const value = match[2];

		if (type === "text") {
			// Decode base64 content
			const content = decodeBase64Content(value);
			if (content) {
				attachments.push({
					type: "text",
					path: "",
					content,
				});
				// Replace token with formatted content block
				const lineCount = (content.match(/\n/g) || []).length + 1;
				const formattedContent = `<pasted-content lines="${lineCount}">\n${content}\n</pasted-content>`;
				expandedText = expandedText.replace(fullMatch, () => formattedContent);
			}
		} else if (type === "command" || type === "skill") {
			const normalized = value.startsWith("/") ? value : `/${value}`;
			attachments.push({
				type,
				path: normalized,
			});
			expandedText = expandedText.replace(fullMatch, () => normalized);
		} else {
			// For file/image, keep the path reference (Claude can access via tools)
			attachments.push({
				type,
				path: value,
			});
			// Keep file/image tokens as-is or format them nicely
			// Claude can use Read tool to access files
			const formattedRef =
				type === "image" ? `[Attached image: ${value}]` : `[Attached file: ${value}]`;
			expandedText = expandedText.replace(fullMatch, () => formattedRef);
		}
	}

	return {
		expandedText: expandedText.trim(),
		attachments,
	};
}

/**
 * Checks if text contains any attachment tokens.
 *
 * @param text - The input text to check
 * @returns True if the text contains attachment tokens
 */
export function hasAttachmentTokens(text: string): boolean {
	const regex = /@\[(file|image|text|command|skill):([^\]]+)\]/;
	return regex.test(text);
}
