import { errAsync, ResultAsync } from "neverthrow";

import { readFileAsDataUrl } from "./file-reader.js";

/** 10 MB limit to prevent OOM from large clipboard images */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageAttachmentError =
	| { kind: "too_large"; maxBytes: number }
	| { kind: "read_failed" };

const MIME_TO_EXT: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/bmp": "bmp",
};

function getExtensionFromMimeType(mimeType: string): string {
	return MIME_TO_EXT[mimeType] ?? "png";
}

function generateImageName(): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	return `image-${timestamp}.png`;
}

export function isImageMimeType(mimeType: string): boolean {
	return mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
}

/**
 * Clipboard-pasted images have base64 content but no filesystem path.
 * File-drop images have a real path and serialize correctly as @[image:/path] tokens.
 * This predicate identifies clipboard images that must be threaded as content blocks.
 */
export function isInlineImageAttachment(a: {
	type: string;
	content?: string;
	path: string;
}): boolean {
	return a.type === "image" && !!a.content && !a.path;
}

export function createImageAttachment(
	file: File,
	mimeType: string
): ResultAsync<
	{ type: "image"; path: string; displayName: string; extension: string; content: string },
	ImageAttachmentError
> {
	if (file.size > MAX_IMAGE_BYTES) {
		return errAsync({ kind: "too_large", maxBytes: MAX_IMAGE_BYTES });
	}
	const extension = file.name?.split(".").pop() ?? getExtensionFromMimeType(mimeType);
	const displayName = file.name || generateImageName();
	return ResultAsync.fromPromise(
		readFileAsDataUrl(file),
		(): ImageAttachmentError => ({ kind: "read_failed" })
	).map((content) => ({
		type: "image" as const,
		path: "",
		displayName,
		extension,
		content,
	}));
}
