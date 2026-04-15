export type LiveMarkdownPresentation = "paragraph" | "heading" | "blockquote" | "list";

export interface LiveMarkdownPromotion {
	markdown: string;
	presentation: LiveMarkdownPresentation;
}

const SAFE_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
const RAW_HTML_PATTERN = /<\/?[A-Za-z][^>\n]*>/;
const TASK_LIST_PATTERN = /^\s*[-*+]\s+\[[ xX]\]\s+/;
const HEADING_PATTERN = /^#{1,6}\s+\S/;
const BLOCKQUOTE_PATTERN = /^\s*>\s?.+/;
const UNORDERED_LIST_PATTERN = /^\s*[-*+]\s+(?!\[[ xX]\])\S/;
const ORDERED_LIST_PATTERN = /^\s*\d+\.\s+\S/;
const CODE_SPAN_PATTERN = /`[^`\n]+`/g;
const STRONG_ASTERISK_PATTERN = /\*\*[^*\n]+\*\*/g;
const EMPHASIS_ASTERISK_PATTERN = /(^|[^*])\*[^*\n]+\*(?!\*)/g;

function classifyPresentation(text: string): LiveMarkdownPresentation {
	const lines = text.split("\n");
	const everyLineIsUnorderedList = lines.every((line) => UNORDERED_LIST_PATTERN.test(line));
	const everyLineIsOrderedList = lines.every((line) => ORDERED_LIST_PATTERN.test(line));

	if (lines.length === 1 && HEADING_PATTERN.test(text)) {
		return "heading";
	}

	if (lines.every((line) => BLOCKQUOTE_PATTERN.test(line))) {
		return "blockquote";
	}

	if (everyLineIsUnorderedList || everyLineIsOrderedList) {
		return "list";
	}

	return "paragraph";
}

function removeSafeLinks(text: string): string {
	return text.replaceAll(SAFE_LINK_PATTERN, (_, _label: string, href: string) => {
		if (href.startsWith("http://") || href.startsWith("https://")) {
			return "";
		}

		return `[link](${href})`;
	});
}

function removeClosedInlineFormatting(text: string): string {
	const withoutCode = text.replaceAll(CODE_SPAN_PATTERN, "");
	const withoutStrong = withoutCode.replaceAll(STRONG_ASTERISK_PATTERN, "");
	return withoutStrong.replaceAll(EMPHASIS_ASTERISK_PATTERN, (_match: string, prefix: string) => prefix);
}

function hasUnsafeLinkSyntax(text: string): boolean {
	const withoutSafeLinks = removeSafeLinks(text);

	if (withoutSafeLinks.includes("javascript:")) {
		return true;
	}

	return withoutSafeLinks.includes("[") || withoutSafeLinks.includes("](");
}

function hasAmbiguousInlineFormatting(text: string): boolean {
	const withoutClosedFormatting = removeClosedInlineFormatting(text);
	return withoutClosedFormatting.includes("*") || withoutClosedFormatting.includes("`");
}

export function promoteLiveMarkdownText(text: string): LiveMarkdownPromotion | null {
	if (text.length === 0) {
		return null;
	}

	if (RAW_HTML_PATTERN.test(text)) {
		return null;
	}

	const lines = text.split("\n");
	const hasAnyUnorderedListLine = lines.some((line) => UNORDERED_LIST_PATTERN.test(line));
	const hasAnyOrderedListLine = lines.some((line) => ORDERED_LIST_PATTERN.test(line));
	if (lines.some((line) => TASK_LIST_PATTERN.test(line))) {
		return null;
	}

	if (hasAnyUnorderedListLine && hasAnyOrderedListLine) {
		return null;
	}

	if (hasUnsafeLinkSyntax(text) || hasAmbiguousInlineFormatting(text)) {
		return null;
	}

	return {
		markdown: text,
		presentation: classifyPresentation(text),
	};
}
