/**
 * Attachment Token Parser
 *
 * Parses attachment tokens in message text and extracts them for proper rendering.
 * Attachment tokens follow the format: @[type:value]
 * Where type is "file", "image", or "text" and value is:
 * - For file/image: the file path
 * - For text: the attachment ID
 *
 * @example
 * Input: "@[image:/path/to/image.png] Hello world"
 * Output: {
 *   attachments: [{ type: "image", path: "/path/to/image.png", displayName: "image.png" }],
 *   textWithoutAttachments: "Hello world"
 * }
 */

/**
 * Represents a parsed attachment from a message.
 */
export interface ParsedAttachment {
	/** Type of attachment: "file", "image", "text", "command", or "skill" */
	type: "file" | "image" | "text" | "command" | "skill";
	/** Full path to the file (empty for text) */
	path: string;
	/** Display name (filename without path) */
	displayName: string;
	/** File extension without the dot */
	extension: string;
	/** Text content (only for text attachments) */
	content?: string;
}

/**
 * Result of parsing attachment tokens from text.
 */
export interface AttachmentParseResult {
	/** Array of parsed attachments */
	attachments: ParsedAttachment[];
	/** The remaining text after removing attachment tokens */
	textWithoutAttachments: string;
}

/**
 * Regex pattern to match attachment tokens.
 * Matches @[type:value] where type is "file", "image", "text", "command", or "skill"
 * and value can contain any characters except ]
 */
const ATTACHMENT_TOKEN_REGEX = /@\[(file|image|text|command|skill):([^\]]+)\]/g;

/**
 * Parses attachment tokens from text and returns structured data.
 * For text attachments, the content should be provided via contentMap.
 *
 * @param text - The input text potentially containing attachment tokens
 * @param contentMap - Optional map of attachment IDs to their text content
 * @returns Object containing parsed attachments and text without tokens
 */
export function parseAttachmentTokens(
	text: string,
	contentMap?: Map<string, string>
): AttachmentParseResult {
	const attachments: ParsedAttachment[] = [];
	let textWithoutAttachments = text;

	// Find all matches
	const matches = text.matchAll(ATTACHMENT_TOKEN_REGEX);

	for (const match of matches) {
		const type = match[1] as "file" | "image" | "text" | "command" | "skill";
		const value = match[2];

		if (type === "text") {
			// For text attachments, value is base64-encoded content
			// Decode the base64 content back to text
			let content: string | undefined;
			try {
				content = decodeURIComponent(escape(atob(value)));
			} catch {
				// If decoding fails, try using contentMap as fallback (for backwards compatibility)
				content = contentMap?.get(value);
			}
			const lineCount = content ? (content.match(/\n/g) || []).length + 1 : 0;
			attachments.push({
				type: "text",
				path: "",
				displayName: `Pasted text (${lineCount} lines)`,
				extension: "txt",
				content,
			});
		} else if (type === "command") {
			attachments.push({
				type: "command",
				path: value,
				displayName: value,
				extension: "cmd",
			});
		} else if (type === "skill") {
			attachments.push({
				type: "skill",
				path: value,
				displayName: value.startsWith("/") ? value.slice(1) : value,
				extension: "skill",
			});
		} else {
			// For file/image attachments, value is the path
			const path = value;
			const fileName = path.split("/").pop() ?? path;
			const extension = fileName.includes(".")
				? (fileName.split(".").pop()?.toLowerCase() ?? "")
				: "";

			attachments.push({
				type,
				path,
				displayName: fileName,
				extension,
			});
		}
	}

	// Remove all attachment tokens from text
	textWithoutAttachments = text.replace(ATTACHMENT_TOKEN_REGEX, "").trim();

	return {
		attachments,
		textWithoutAttachments,
	};
}

/**
 * Checks if text contains any attachment tokens.
 *
 * @param text - The input text to check
 * @returns True if the text contains attachment tokens
 */
export function hasAttachmentTokens(text: string): boolean {
	// Use a fresh regex to avoid global flag state issues
	const regex = /@\[(file|image|text|command|skill):([^\]]+)\]/;
	return regex.test(text);
}
