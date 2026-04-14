const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function splitGraphemes(text: string): string[] {
	return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
}

export function splitGraphemesSuffix(existing: string[], fullText: string, previousText: string): string[] {
	const suffix = fullText.slice(previousText.length);
	if (suffix.length === 0) {
		return existing;
	}

	const newGraphemes = splitGraphemes(suffix);
	const combined = new Array<string>(existing.length + newGraphemes.length);
	for (let i = 0; i < existing.length; i++) {
		combined[i] = existing[i]!;
	}
	for (let i = 0; i < newGraphemes.length; i++) {
		combined[existing.length + i] = newGraphemes[i]!;
	}
	return combined;
}
