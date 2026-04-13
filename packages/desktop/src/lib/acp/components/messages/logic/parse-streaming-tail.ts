export type StreamingTailSection =
	| {
			key: string;
			kind: "settled";
			markdown: string;
	  }
	| {
			key: string;
			kind: "live-text";
			text: string;
			source: string;
	  }
	| {
			key: string;
			kind: "live-code";
			code: string;
			language: string | null;
			source: string;
	  };

export interface StreamingTailParseResult {
	sections: StreamingTailSection[];
}

function rekeySection(section: StreamingTailSection, index: number): StreamingTailSection {
	if (section.kind === "settled") {
		return createSettledSection(index, section.markdown);
	}

	if (section.kind === "live-code") {
		return createLiveCodeSection(index, section.code, section.language, section.source);
	}

	return createLiveTextSection(index, section.text);
}

function buildReparseSource(section: StreamingTailSection): string | null {
	if (section.kind === "live-text") {
		return section.source;
	}

	if (section.kind === "live-code") {
		return section.source;
	}

	return null;
}

function createSettledSection(index: number, markdown: string): StreamingTailSection {
	return {
		key: `SETTLED:${index}`,
		kind: "settled",
		markdown,
	};
}

function createLiveTextSection(index: number, text: string): StreamingTailSection {
	return {
		key: `LIVE:${index}`,
		kind: "live-text",
		text,
		source: text,
	};
}

function createLiveCodeSection(
	index: number,
	code: string,
	language: string | null,
	source: string
): StreamingTailSection {
	return {
		key: `LIVE:${index}`,
		kind: "live-code",
		code,
		language,
		source,
	};
}

function parseFenceLanguage(line: string): string | null {
	const match = /^```([^\s`]+)?/.exec(line);
	const language = match?.[1];
	return language && language.length > 0 ? language : null;
}

export function parseStreamingTail(text: string): StreamingTailParseResult {
	if (text.length === 0) {
		return { sections: [] };
	}

	const lines = text.split("\n");
	const sections: StreamingTailSection[] = [];
	let blockIndex = 0;
	let buffer: string[] = [];
	let inFence = false;
	let openFenceLanguage: string | null = null;

	function flushSettledBuffer() {
		if (buffer.length === 0) {
			return;
		}

		sections.push(createSettledSection(blockIndex, buffer.join("\n")));
		blockIndex += 1;
		buffer = [];
	}

	for (const line of lines) {
		if (inFence) {
			buffer.push(line);

			if (line.startsWith("```")) {
				flushSettledBuffer();
				inFence = false;
				openFenceLanguage = null;
			}

			continue;
		}

		if (line.startsWith("```")) {
			flushSettledBuffer();
			buffer.push(line);
			inFence = true;
			openFenceLanguage = parseFenceLanguage(line);
			continue;
		}

		if (line.trim().length === 0) {
			flushSettledBuffer();
			continue;
		}

		buffer.push(line);
	}

	if (buffer.length === 0) {
		return { sections };
	}

	if (inFence) {
		sections.push(
			createLiveCodeSection(
				blockIndex,
				buffer.slice(1).join("\n"),
				openFenceLanguage,
				buffer.join("\n")
			)
		);
		return { sections };
	}

	sections.push(createLiveTextSection(blockIndex, buffer.join("\n")));
	return { sections };
}

export function parseStreamingTailIncremental(
	previousText: string,
	previousResult: StreamingTailParseResult,
	nextText: string
): StreamingTailParseResult {
	if (
		previousText.length === 0 ||
		previousResult.sections.length === 0 ||
		!nextText.startsWith(previousText)
	) {
		return parseStreamingTail(nextText);
	}

	const lastSection = previousResult.sections[previousResult.sections.length - 1];
	const reparseSource = buildReparseSource(lastSection);
	if (reparseSource === null) {
		return parseStreamingTail(nextText);
	}

	const appendedSuffix = nextText.slice(previousText.length);
	const reparsed = parseStreamingTail(`${reparseSource}${appendedSuffix}`);
	const sections: StreamingTailSection[] = [];
	const stableCount = previousResult.sections.length - 1;

	for (let index = 0; index < stableCount; index += 1) {
		sections.push(previousResult.sections[index]);
	}

	for (let index = 0; index < reparsed.sections.length; index += 1) {
		sections.push(rekeySection(reparsed.sections[index], stableCount + index));
	}

	return { sections };
}
