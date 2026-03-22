import { ok, type Result } from "neverthrow";
import { serializeWithAttachments } from "../../../store/message-queue/message-queue-store.svelte.js";
import type { ValidationError } from "../errors/agent-input-error.js";
import type { Attachment } from "../types/attachment.js";
import { isInlineImageAttachment } from "./image-attachment.js";
import { validateMessage } from "./message-validator.js";

export interface PreparedMessage {
	/** Message with @[text_ref:UUID] expanded to @[text:BASE64], non-image attachments serialized */
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

/**
 * Prepare a message for sending: expand inline refs, serialize attachments, validate.
 * This is the single source of truth for message preparation — all send paths use it.
 *
 * Image attachments with base64 content (clipboard pastes) are separated out and
 * returned in `imageAttachments` — they are sent as structured content blocks, not
 * serialized as text tokens. File-drop images with real paths are still serialized.
 */
export function prepareMessageForSend(
	message: string,
	inlineTextMap: ReadonlyMap<string, string>,
	attachments: readonly Attachment[]
): Result<PreparedMessage, ValidationError> {
	const imageAttachments = attachments.filter(isInlineImageAttachment);
	const otherAttachments = attachments.filter((a) => !isInlineImageAttachment(a));

	const expanded = expandInlineReferenceTokens(message, inlineTextMap);
	const withAttachments = serializeWithAttachments(expanded, otherAttachments);

	// Allow image-only messages (empty text + pasted images)
	if (!withAttachments.trim() && imageAttachments.length > 0) {
		return ok({ content: "", imageAttachments });
	}

	return validateMessage(withAttachments).map((content) => ({ content, imageAttachments }));
}
