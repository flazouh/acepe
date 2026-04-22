/**
 * Extract attachment chips from a user message's content chunks.
 *
 * Handles both:
 * - Inline `@[type:value]` tokens embedded in text chunks (composer-style drafts)
 * - Resource-link / image ContentBlocks produced after message submission
 *
 * Produces the same `ParsedAttachment` shape used everywhere else in the app
 * so the shared `AttachmentChip` component can render them uniformly.
 */

import type { ContentBlock } from "../../services/converted-session-types.js";
import { type ParsedAttachment, parseAttachmentTokens } from "./attachment-token-parser.js";

function extensionFromName(name: string): string {
	const lastDot = name.lastIndexOf(".");
	if (lastDot < 0 || lastDot >= name.length - 1) return "";
	return name.slice(lastDot + 1).toLowerCase();
}

function extensionFromMime(mimeType: string | null | undefined): string {
	if (!mimeType || !mimeType.startsWith("image/")) return "png";
	const sub = mimeType.slice("image/".length);
	return sub.includes("+") ? sub.split("+")[0] : sub;
}

function imageDisplayName(block: { uri?: string | null }): string {
	if (block.uri) {
		const segment = block.uri.split("/").pop();
		if (segment && segment.length > 0) return segment;
	}
	return "Image";
}

export function extractAttachmentsFromChunks(chunks: readonly ContentBlock[]): ParsedAttachment[] {
	const results: ParsedAttachment[] = [];
	for (const block of chunks) {
		if (block.type === "text") {
			results.push(...parseAttachmentTokens(block.text).attachments);
		} else if (block.type === "resource_link") {
			const name = block.name;
			results.push({
				type: "file",
				path: block.uri,
				displayName: name,
				extension: extensionFromName(name),
			});
		} else if (block.type === "image") {
			results.push({
				type: "image",
				path: block.uri ?? "",
				displayName: imageDisplayName(block),
				extension: extensionFromMime(block.mimeType),
			});
		}
	}
	return results;
}
