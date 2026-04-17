import {
	promoteLiveMarkdownText,
	type LiveMarkdownPresentation,
} from "./live-markdown-promotion.js";
import type { StreamingTailSection } from "./parse-streaming-tail.js";

type SegmenterLike = {
	segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

export type StreamingTextToken = {
	key: string;
	text: string;
	animate: boolean;
};

export type StreamingInlineLeaf =
	| {
			key: string;
			kind: "text";
			tokens: StreamingTextToken[];
	  }
	| {
			key: string;
			kind: "code" | "strong" | "em" | "link";
			text: string;
			animate: boolean;
	  };

export type StreamingInlineLine = {
	key: string;
	leaves: StreamingInlineLeaf[];
};

export type LiveStreamingSectionView =
	| {
			key: string;
			kind: "plain-text";
			tokens: StreamingTextToken[];
	  }
	| {
			key: string;
			kind: "code";
			code: string;
			language: string | null;
			animate: boolean;
	  }
	| {
			key: string;
			kind: "paragraph";
			leaves: StreamingInlineLeaf[];
	  }
	| {
			key: string;
			kind: "heading";
			level: number;
			leaves: StreamingInlineLeaf[];
	  }
	| {
			key: string;
			kind: "blockquote";
			lines: StreamingInlineLine[];
	  }
	| {
			key: string;
			kind: "list";
			ordered: boolean;
			start: number | null;
			items: StreamingInlineLine[];
	  };

type MatchCandidate =
	| {
			type: "code" | "link" | "strong";
			renderStart: number;
			consumeLength: number;
			text: string;
	  }
	| {
			type: "em";
			renderStart: number;
			consumeLength: number;
			text: string;
	  };

const CODE_SPAN_PATTERN = /`([^`\n]+)`/;
const SAFE_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\n]+)\)/;
const STRONG_PATTERN = /\*\*([^*\n]+)\*\*/;
const EMPHASIS_PATTERN = /(^|[^*])\*([^*\n]+)\*(?!\*)/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_PREFIX_PATTERN = /^\s*>\s?/;
const ORDERED_LIST_PREFIX_PATTERN = /^\s*(\d+)\.\s+/;
const UNORDERED_LIST_PREFIX_PATTERN = /^\s*[-*+]\s+/;
const FENCE_START_PATTERN = /^```([^\s`]+)?$/;
const FENCE_END = "```";

let sharedSegmenter: SegmenterLike | null | undefined;

function getSegmenter(): SegmenterLike | null {
	if (sharedSegmenter !== undefined) {
		return sharedSegmenter;
	}

	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		sharedSegmenter = new (
			Intl as typeof Intl & {
				Segmenter: new (locale: string, options: { granularity: string }) => SegmenterLike;
			}
		).Segmenter("en", { granularity: "word" });
		return sharedSegmenter;
	}

	sharedSegmenter = null;
	return sharedSegmenter;
}

function isSafeExternalHref(href: string): boolean {
	return href.startsWith("https://") || href.startsWith("http://");
}

function buildTextTokens(text: string, keyBase: string, animate: boolean): StreamingTextToken[] {
	if (text.length === 0) {
		return [];
	}

	const tokens: StreamingTextToken[] = [];
	const segmenter = getSegmenter();
	if (segmenter !== null) {
		let index = 0;
		for (const part of segmenter.segment(text)) {
			tokens.push({
				key: `${keyBase}:token:${index}`,
				text: part.segment,
				animate: animate && part.isWordLike === true,
			});
			index += 1;
		}
		return tokens;
	}

	const parts = text.split(/(\s+)/);
	let index = 0;
	for (const part of parts) {
		if (part.length === 0) {
			continue;
		}
		tokens.push({
			key: `${keyBase}:token:${index}`,
			text: part,
			animate: animate && /^\s+$/.test(part) === false,
		});
		index += 1;
	}
	return tokens;
}

function createTextLeaf(key: string, text: string, animate: boolean): StreamingInlineLeaf | null {
	if (text.length === 0) {
		return null;
	}
	return {
		key,
		kind: "text",
		tokens: buildTextTokens(text, key, animate),
	};
}

function createFormattedLeaf(
	key: string,
	kind: "code" | "strong" | "em" | "link",
	text: string,
	animate: boolean
): StreamingInlineLeaf {
	return {
		key,
		kind,
		text,
		animate,
	};
}

function chooseEarlierCandidate(
	current: MatchCandidate | null,
	next: MatchCandidate | null
): MatchCandidate | null {
	if (next === null) {
		return current;
	}
	if (current === null) {
		return next;
	}
	if (next.renderStart < current.renderStart) {
		return next;
	}
	return current;
}

function findNextInlineMatch(text: string): MatchCandidate | null {
	let best: MatchCandidate | null = null;

	const codeMatch = CODE_SPAN_PATTERN.exec(text);
	if (codeMatch !== null) {
		best = chooseEarlierCandidate(best, {
			type: "code",
			renderStart: codeMatch.index,
			consumeLength: codeMatch[0].length,
			text: codeMatch[1],
		});
	}

	const linkMatch = SAFE_LINK_PATTERN.exec(text);
	if (linkMatch !== null && isSafeExternalHref(linkMatch[2])) {
		best = chooseEarlierCandidate(best, {
			type: "link",
			renderStart: linkMatch.index,
			consumeLength: linkMatch[0].length,
			text: linkMatch[1],
		});
	}

	const strongMatch = STRONG_PATTERN.exec(text);
	if (strongMatch !== null) {
		best = chooseEarlierCandidate(best, {
			type: "strong",
			renderStart: strongMatch.index,
			consumeLength: strongMatch[0].length,
			text: strongMatch[1],
		});
	}

	const emphasisMatch = EMPHASIS_PATTERN.exec(text);
	if (emphasisMatch !== null) {
		best = chooseEarlierCandidate(best, {
			type: "em",
			renderStart: emphasisMatch.index + emphasisMatch[1].length,
			consumeLength: emphasisMatch[0].length,
			text: emphasisMatch[2],
		});
	}

	return best;
}

function buildInlineLeaves(text: string, keyBase: string, animate: boolean): StreamingInlineLeaf[] {
	const leaves: StreamingInlineLeaf[] = [];
	let remaining = text;
	let index = 0;

	while (remaining.length > 0) {
		const match = findNextInlineMatch(remaining);
		if (match === null) {
			const plainLeaf = createTextLeaf(`${keyBase}:leaf:${index}`, remaining, animate);
			if (plainLeaf !== null) {
				leaves.push(plainLeaf);
			}
			break;
		}

		if (match.renderStart > 0) {
			const plainLeaf = createTextLeaf(
				`${keyBase}:leaf:${index}`,
				remaining.slice(0, match.renderStart),
				animate
			);
			if (plainLeaf !== null) {
				leaves.push(plainLeaf);
				index += 1;
			}
		}

		leaves.push(
			createFormattedLeaf(`${keyBase}:leaf:${index}`, match.type, match.text, animate)
		);
		index += 1;
		remaining = remaining.slice(match.consumeLength);
	}

	return leaves;
}

function buildParagraphView(
	key: string,
	text: string,
	animate: boolean
): LiveStreamingSectionView {
	return {
		key,
		kind: "paragraph",
		leaves: buildInlineLeaves(text, `${key}:paragraph`, animate),
	};
}

function buildHeadingView(key: string, markdown: string, animate: boolean): LiveStreamingSectionView {
	const match = HEADING_PATTERN.exec(markdown);
	if (match === null) {
		return buildParagraphView(key, markdown, animate);
	}
	return {
		key,
		kind: "heading",
		level: match[1].length,
		leaves: buildInlineLeaves(match[2], `${key}:heading`, animate),
	};
}

function buildBlockquoteView(
	key: string,
	markdown: string,
	animate: boolean
): LiveStreamingSectionView {
	const lines = markdown.split("\n").map((line, index) => ({
		key: `${key}:line:${index}`,
		leaves: buildInlineLeaves(
			line.replace(BLOCKQUOTE_PREFIX_PATTERN, ""),
			`${key}:line:${index}`,
			animate
		),
	}));
	return {
		key,
		kind: "blockquote",
		lines,
	};
}

function buildListView(key: string, markdown: string, animate: boolean): LiveStreamingSectionView {
	const lines = markdown.split("\n");
	const firstOrderedMatch = ORDERED_LIST_PREFIX_PATTERN.exec(lines[0]);
	const ordered = firstOrderedMatch !== null;
	const start = firstOrderedMatch === null ? null : Number.parseInt(firstOrderedMatch[1], 10);
	const items = lines.map((line, index) => {
		const text = ordered
			? line.replace(ORDERED_LIST_PREFIX_PATTERN, "")
			: line.replace(UNORDERED_LIST_PREFIX_PATTERN, "");
		return {
			key: `${key}:item:${index}`,
			leaves: buildInlineLeaves(text, `${key}:item:${index}`, animate),
		};
	});
	return {
		key,
		kind: "list",
		ordered,
		start,
		items,
	};
}

function parseFencedCodeBlock(markdown: string): { language: string | null; code: string } | null {
	const lines = markdown.split("\n");
	if (lines.length < 2) {
		return null;
	}

	const openingFenceMatch = FENCE_START_PATTERN.exec(lines[0]);
	if (openingFenceMatch === null) {
		return null;
	}

	if (lines[lines.length - 1] !== FENCE_END) {
		return null;
	}

	const language =
		openingFenceMatch[1] !== undefined && openingFenceMatch[1].length > 0
			? openingFenceMatch[1]
			: null;
	if (language === "mermaid") {
		return null;
	}

	return {
		language,
		code: lines.slice(1, -1).join("\n"),
	};
}

function buildMarkdownPresentationView(
	key: string,
	markdown: string,
	presentation: LiveMarkdownPresentation,
	animate: boolean
): LiveStreamingSectionView {
	if (presentation === "heading") {
		return buildHeadingView(key, markdown, animate);
	}

	if (presentation === "blockquote") {
		return buildBlockquoteView(key, markdown, animate);
	}

	if (presentation === "list") {
		return buildListView(key, markdown, animate);
	}

	return buildParagraphView(key, markdown, animate);
}

export function buildLiveStreamingSectionView(
	section: Extract<
		StreamingTailSection,
		{ kind: "settled" | "live-text" | "live-markdown" | "live-code" }
	>,
	options: { animate?: boolean } = {}
): LiveStreamingSectionView {
	const animate = options.animate ?? false;
	if (section.kind === "settled") {
		const fencedCodeBlock = parseFencedCodeBlock(section.markdown);
		if (fencedCodeBlock !== null) {
			return {
				key: section.key,
				kind: "code",
				code: fencedCodeBlock.code,
				language: fencedCodeBlock.language,
				animate: false,
			};
		}

		const promotion = promoteLiveMarkdownText(section.markdown);
		if (promotion === null) {
			return {
				key: section.key,
				kind: "plain-text",
				tokens: buildTextTokens(section.markdown, `${section.key}:plain`, false),
			};
		}

		return buildMarkdownPresentationView(
			section.key,
			promotion.markdown,
			promotion.presentation,
			false
		);
	}

	if (section.kind === "live-code") {
		return {
			key: section.key,
			kind: "code",
			code: section.code,
			language: section.language,
			animate,
		};
	}

	if (section.kind === "live-text") {
		return {
			key: section.key,
			kind: "plain-text",
			tokens: buildTextTokens(section.text, `${section.key}:plain`, animate),
		};
	}

	return buildMarkdownPresentationView(
		section.key,
		section.markdown,
		section.presentation,
		animate
	);
}
