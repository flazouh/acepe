const DECIDING_PREFIX = "Deciding response approach";

export function sanitizeAssistantText(text: string): string {
	const trimmedStart = text.trimStart();
	if (trimmedStart.length === 0) {
		return trimmedStart;
	}

	const plainPrefix = trimmedStart.startsWith(DECIDING_PREFIX);
	const boldPrefix = trimmedStart.startsWith(`**${DECIDING_PREFIX}**`);

	if (!plainPrefix && !boldPrefix) {
		return text;
	}

	const stripped = trimmedStart.replace(
		/^\*\*Deciding response approach\*\*|^Deciding response approach/i,
		""
	);

	return stripped.replace(/^[\s:\-–—]+/, "").trimStart();
}
