export const SPOKEN_REPLY_MAX_CHARS = 8000;

export function prepareSpokenReplyText(text: string): string | null {
	const collapsed = text.trim().replace(/\s+/g, " ");
	if (collapsed.length === 0) {
		return null;
	}

	if (collapsed.length <= SPOKEN_REPLY_MAX_CHARS) {
		return collapsed;
	}

	return collapsed.slice(0, SPOKEN_REPLY_MAX_CHARS);
}
