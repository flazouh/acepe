/**
 * Type of attachment that can be added to a message.
 */
export type AttachmentType = "file" | "image" | "text" | "command" | "skill";

/**
 * Represents an attachment (file or image) added to a message.
 * Legacy attachment-array images are still supported for queued messages;
 * new composer images use `@[image_ref:UUID]` inline tokens instead.
 */
export interface Attachment {
	/** Unique identifier for the attachment (UUID) */
	readonly id: string;
	/** Type of attachment */
	readonly type: AttachmentType;
	/** Full path for files, filename for images, empty for text */
	readonly path: string;
	/** Display name shown in the badge (typically just the filename) */
	readonly displayName: string;
	/** File extension for icon lookup (without dot) */
	readonly extension: string;
	/** Content data: text content for "text" type, base64 data URL for "image" type */
	readonly content?: string;
}
