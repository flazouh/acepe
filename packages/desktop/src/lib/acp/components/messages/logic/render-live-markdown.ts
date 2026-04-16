import { promoteLiveMarkdownText, type LiveMarkdownPresentation } from "./live-markdown-promotion.js";
import type { StreamingTailSection } from "./parse-streaming-tail.js";
import { wrapWordsForAnimation } from "./wrap-words-for-animation.js";

type RenderableStreamingSection = Extract<
	StreamingTailSection,
	{ kind: "settled" | "live-markdown" }
>;

export interface LiveMarkdownRenderResult {
	html: string | null;
}

const SAFE_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
const CODE_SPAN_PATTERN = /`([^`\n]+)`/g;
const STRONG_ASTERISK_PATTERN = /\*\*([^*\n]+)\*\*/g;
const EMPHASIS_ASTERISK_PATTERN = /(^|[^*])\*([^*\n]+)\*(?!\*)/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_PREFIX_PATTERN = /^\s*>\s?/;
const UNORDERED_LIST_PREFIX_PATTERN = /^\s*[-*+]\s+/;
const ORDERED_LIST_PREFIX_PATTERN = /^\s*\d+\.\s+/;
const FENCE_START_PATTERN = /^```([^\s`]+)?$/;
const FENCE_END = "```";

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function createTokenHtml(htmlByToken: Map<string, string>, html: string): string {
	const token = `@@LIVE_MD_${htmlByToken.size}@@`;
	htmlByToken.set(token, html);
	return token;
}

function restoreTokenHtml(
	text: string,
	htmlByToken: ReadonlyMap<string, string>,
	animate: boolean
): string {
	let restored = text;
	for (const [token, html] of htmlByToken.entries()) {
		// When animating, wrap each restored inline token in a fade span so the
		// entire <strong>, <em>, <code>, or disabled link fades as a unit.
		const replacement = animate ? `<span class="sd-word-fade">${html}</span>` : html;
		restored = restored.replaceAll(token, replacement);
	}
	return restored;
}

function isSafeExternalHref(href: string): boolean {
	return href.startsWith("https://") || href.startsWith("http://");
}

function renderInlineMarkdown(text: string, animate: boolean): string {
	const htmlByToken = new Map<string, string>();

	let templated = text.replaceAll(CODE_SPAN_PATTERN, (_match: string, content: string) =>
		createTokenHtml(htmlByToken, `<code>${escapeHtml(content)}</code>`)
	);

	templated = templated.replaceAll(
		SAFE_LINK_PATTERN,
		(match: string, label: string, href: string) => {
			if (!isSafeExternalHref(href)) {
				return match;
			}

			return createTokenHtml(
				htmlByToken,
				`<span class="streaming-live-link is-disabled" data-streaming-link-state="disabled">${escapeHtml(label)}</span>`
			);
		}
	);

	templated = templated.replaceAll(STRONG_ASTERISK_PATTERN, (_match: string, content: string) =>
		createTokenHtml(htmlByToken, `<strong>${escapeHtml(content)}</strong>`)
	);

	templated = templated.replaceAll(
		EMPHASIS_ASTERISK_PATTERN,
		(_match: string, prefix: string, content: string) =>
			`${prefix}${createTokenHtml(htmlByToken, `<em>${escapeHtml(content)}</em>`)}`
	);

	// Escape the plain text segments (placeholders are not escaped — they are
	// literal ASCII and contain no HTML-special characters).
	const escaped = escapeHtml(templated);

	// Wrap plain-text words in fade spans when animation is enabled.
	const wrapped = animate ? wrapWordsForAnimation(escaped) : escaped;

	return restoreTokenHtml(wrapped, htmlByToken, animate);
}

function parseFencedCodeBlock(markdown: string): { language: string | null; code: string } | null {
	const lines = markdown.split("\n");
	if (lines.length < 2) {
		return null;
	}

	const openingFenceMatch = FENCE_START_PATTERN.exec(lines[0]);
	if (!openingFenceMatch) {
		return null;
	}

	if (lines[lines.length - 1] !== FENCE_END) {
		return null;
	}

	const language = openingFenceMatch[1] && openingFenceMatch[1].length > 0 ? openingFenceMatch[1] : null;
	if (language === "mermaid") {
		return null;
	}

	return {
		language,
		code: lines.slice(1, -1).join("\n"),
	};
}

function renderParagraph(markdown: string, animate: boolean): string {
	return `<p>${renderInlineMarkdown(markdown, animate)}</p>`;
}

function renderHeading(markdown: string, animate: boolean): string | null {
	const match = HEADING_PATTERN.exec(markdown);
	if (!match) {
		return null;
	}

	const level = match[1].length;
	return `<h${level}>${renderInlineMarkdown(match[2], animate)}</h${level}>`;
}

function renderBlockquote(markdown: string, animate: boolean): string {
	const lines = markdown
		.split("\n")
		.map((line) => line.replace(BLOCKQUOTE_PREFIX_PATTERN, ""));
	return `<blockquote><p>${lines.map((line) => renderInlineMarkdown(line, animate)).join("<br>")}</p></blockquote>`;
}

function renderList(markdown: string, animate: boolean): string {
	const lines = markdown.split("\n");
	const isOrdered = ORDERED_LIST_PREFIX_PATTERN.test(lines[0]);
	const tagName = isOrdered ? "ol" : "ul";
	const orderedListStartMatch = isOrdered ? /^\s*(\d+)\.\s+/.exec(lines[0]) : null;
	const startAttribute =
		orderedListStartMatch !== null && orderedListStartMatch[1] !== "1"
			? ` start="${escapeHtml(orderedListStartMatch[1])}"`
			: "";
	const itemsHtml = lines
		.map((line) => {
			const itemText = isOrdered
				? line.replace(ORDERED_LIST_PREFIX_PATTERN, "")
				: line.replace(UNORDERED_LIST_PREFIX_PATTERN, "");
			return `<li>${renderInlineMarkdown(itemText, animate)}</li>`;
		})
		.join("");
	return `<${tagName}${startAttribute}>${itemsHtml}</${tagName}>`;
}

function renderPresentation(
	markdown: string,
	presentation: LiveMarkdownPresentation,
	animate: boolean
): string | null {
	if (presentation === "heading") {
		return renderHeading(markdown, animate);
	}

	if (presentation === "blockquote") {
		return renderBlockquote(markdown, animate);
	}

	if (presentation === "list") {
		return renderList(markdown, animate);
	}

	return renderParagraph(markdown, animate);
}

export function renderLiveMarkdownSection(
	section: RenderableStreamingSection,
	options: { animate?: boolean } = {}
): LiveMarkdownRenderResult {
	const animate = options.animate ?? false;

	const fencedCodeBlock =
		section.kind === "settled" ? parseFencedCodeBlock(section.markdown) : null;
	if (fencedCodeBlock) {
		const languageAttribute =
			fencedCodeBlock.language === null
				? ""
				: ` data-language="${escapeHtml(fencedCodeBlock.language)}"`;
		// Settled fenced code blocks get a block-level fade-in class (no per-word wrapping inside code).
		const fadeClass = animate ? ' class="streaming-live-code sd-word-fade"' : ' class="streaming-live-code"';
		return {
			html: `<pre${fadeClass}><code${languageAttribute}>${escapeHtml(fencedCodeBlock.code)}</code></pre>`,
		};
	}

	const promotion =
		section.kind === "live-markdown"
			? {
					markdown: section.markdown,
					presentation: section.presentation,
				}
			: promoteLiveMarkdownText(section.markdown);

	if (promotion === null) {
		return { html: null };
	}

	return {
		html: renderPresentation(promotion.markdown, promotion.presentation, animate),
	};
}
