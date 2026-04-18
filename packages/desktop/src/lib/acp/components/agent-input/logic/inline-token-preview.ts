import { Result } from "neverthrow";

const HOVER_PREVIEW_MAX_CHARS = 500;

export function truncateHoverPreview(value: string): string {
	if (value.length <= HOVER_PREVIEW_MAX_CHARS) {
		return value;
	}
	return `${value.slice(0, HOVER_PREVIEW_MAX_CHARS)}…`;
}

export function decodeInlineTextTokenValue(value: string): string | null {
	const result = Result.fromThrowable(
		(v: string) => decodeURIComponent(escape(atob(v))),
		() => new Error("Invalid base64 or URI")
	)(value);
	return result.isOk() ? result.value : null;
}
