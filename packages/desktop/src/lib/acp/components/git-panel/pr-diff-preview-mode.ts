const LARGE_PATCH_CHAR_THRESHOLD = 24_000;
const LARGE_PATCH_LINE_THRESHOLD = 900;

export function shouldUsePlainTextDiffPreview(patch: string): boolean {
	if (patch.length >= LARGE_PATCH_CHAR_THRESHOLD) {
		return true;
	}

	let lineCount = 1;
	for (const char of patch) {
		if (char === "\n") {
			lineCount += 1;
		}
	}

	return lineCount >= LARGE_PATCH_LINE_THRESHOLD;
}
