export function normalizeVoiceInputText(text: string): string {
	return text
		.replace(/\\n/g, " ")
		.replace(/\s*\n\s*/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
