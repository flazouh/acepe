import { ok, type Result } from "neverthrow";
import { serializeWithAttachments } from "../../../store/message-queue/message-queue-store.svelte.js";
import type { ValidationError } from "../errors/agent-input-error.js";
import type { Attachment } from "../types/attachment.js";
import type { InlineImageReference } from "../types/inline-image-reference.js";
import { isInlineImageAttachment } from "./image-attachment.js";
import { validateMessage } from "./message-validator.js";

export interface PreparedMessage {
	/** Message with @[text_ref:UUID] expanded to @[text:BASE64], inline image refs stripped */
	content: string;
	/** Image attachments with base64 content, threaded separately as content blocks */
	imageAttachments: readonly Attachment[];
}

/**
 * Expand @[text_ref:UUID] tokens using the provided lookup map.
 * Returns @[text:BASE64] tokens (self-contained, no map needed downstream).
 */
function expandInlineReferenceTokens(
	message: string,
	textMap: ReadonlyMap<string, string>
): string {
	return message.replace(/@\[text_ref:([^\]]+)\]/g, (_full, refId: string) => {
		const content = textMap.get(refId);
		if (!content) return "";
		return `@[text:${btoa(unescape(encodeURIComponent(content)))}]`;
	});
}

function extractInlineImageReferences(
	message: string,
	imageMap: ReadonlyMap<string, InlineImageReference>
): { content: string; imageAttachments: Attachment[] } {
	const imageAttachments: Attachment[] = [];
	const content = message.replace(/@\[image_ref:([^\]]+)\]\s?/g, (_full, refId: string) => {
		const imageRef = imageMap.get(refId);
		if (!imageRef) {
			return "";
		}
		imageAttachments.push({
			id: refId,
			type: "image",
			path: imageRef.path,
			displayName: imageRef.displayName,
			extension: imageRef.extension,
			content: imageRef.content,
		});
		return "";
	});

	return { content, imageAttachments };
}

/**
 * Prepare a message for sending: expand inline refs, serialize attachments, validate.
 * This is the single source of truth for message preparation — all send paths use it.
 *
 * Clipboard images use `@[image_ref:UUID]` tokens resolved from `inlineImageMap`.
 * Legacy attachment-array images are still supported for queued/restored messages.
 */
export function prepareMessageForSend(
	message: string,
	inlineTextMap: ReadonlyMap<string, string>,
	attachments: readonly Attachment[],
	inlineImageMap: ReadonlyMap<string, InlineImageReference> = new Map()
): Result<PreparedMessage, ValidationError> {
	const legacyImageAttachments = attachments.filter(isInlineImageAttachment);
	const otherAttachments = attachments.filter((attachment) => !isInlineImageAttachment(attachment));

	const expanded = expandInlineReferenceTokens(message, inlineTextMap);
	const extracted = extractInlineImageReferences(expanded, inlineImageMap);
	const imageAttachments = extracted.imageAttachments.concat(legacyImageAttachments);
	const withAttachments = serializeWithAttachments(extracted.content, otherAttachments);

	// Allow image-only messages (empty text + inline or legacy images)
	if (!withAttachments.trim() && imageAttachments.length > 0) {
		return ok({ content: "", imageAttachments });
	}

	return validateMessage(withAttachments).map((content) => ({ content, imageAttachments }));
}
