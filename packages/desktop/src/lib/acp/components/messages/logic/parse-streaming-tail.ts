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
	  }
	| {
			key: string;
			kind: "live-code";
			code: string;
			language: string | null;
	  };

export interface StreamingTailParseResult {
	sections: StreamingTailSection[];
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
	};
}

function createLiveCodeSection(
	index: number,
	code: string,
	language: string | null
): StreamingTailSection {
	return {
		key: `LIVE:${index}`,
		kind: "live-code",
		code,
		language,
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
		sections.push(createLiveCodeSection(blockIndex, buffer.slice(1).join("\n"), openFenceLanguage));
		return { sections };
	}

	sections.push(createLiveTextSection(blockIndex, buffer.join("\n")));
	return { sections };
}
