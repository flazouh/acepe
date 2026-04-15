import { promoteLiveMarkdownText, type LiveMarkdownPresentation } from "./live-markdown-promotion.js";
import type { StreamingTailSection } from "./parse-streaming-tail.js";

export const LIVE_MARKDOWN_RENDER_BUDGET_MS = 8;
export const LIVE_MARKDOWN_RENDER_BREACH_LIMIT = 2;

type RenderableStreamingSection = Extract<
	StreamingTailSection,
	{ kind: "settled" | "live-markdown" }
>;

export interface LiveMarkdownRenderResult {
	html: string | null;
	durationMs: number;
}

interface RenderLiveMarkdownOptions {
	nowMs?: () => number;
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

function getNowMs(): number {
	return performance.now();
}

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

function restoreTokenHtml(text: string, htmlByToken: ReadonlyMap<string, string>): string {
	let restored = text;
	for (const [token, html] of htmlByToken.entries()) {
		restored = restored.replaceAll(token, html);
	}
	return restored;
}

function isSafeExternalHref(href: string): boolean {
	return href.startsWith("https://") || href.startsWith("http://");
}

function renderInlineMarkdown(text: string): string {
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

	return restoreTokenHtml(escapeHtml(templated), htmlByToken);
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

function renderParagraph(markdown: string): string {
	return `<p>${renderInlineMarkdown(markdown)}</p>`;
}

function renderHeading(markdown: string): string | null {
	const match = HEADING_PATTERN.exec(markdown);
	if (!match) {
		return null;
	}

	const level = match[1].length;
	return `<h${level}>${renderInlineMarkdown(match[2])}</h${level}>`;
}

function renderBlockquote(markdown: string): string {
	const lines = markdown
		.split("\n")
		.map((line) => line.replace(BLOCKQUOTE_PREFIX_PATTERN, ""));
	return `<blockquote><p>${lines.map((line) => renderInlineMarkdown(line)).join("<br>")}</p></blockquote>`;
}

function renderList(markdown: string): string {
	const lines = markdown.split("\n");
	const isOrdered = ORDERED_LIST_PREFIX_PATTERN.test(lines[0]);
	const tagName = isOrdered ? "ol" : "ul";
	const itemsHtml = lines
		.map((line) => {
			const itemText = isOrdered
				? line.replace(ORDERED_LIST_PREFIX_PATTERN, "")
				: line.replace(UNORDERED_LIST_PREFIX_PATTERN, "");
			return `<li>${renderInlineMarkdown(itemText)}</li>`;
		})
		.join("");
	return `<${tagName}>${itemsHtml}</${tagName}>`;
}

function renderPresentation(markdown: string, presentation: LiveMarkdownPresentation): string | null {
	if (presentation === "heading") {
		return renderHeading(markdown);
	}

	if (presentation === "blockquote") {
		return renderBlockquote(markdown);
	}

	if (presentation === "list") {
		return renderList(markdown);
	}

	return renderParagraph(markdown);
}

export function renderLiveMarkdownSection(
	section: RenderableStreamingSection,
	options: RenderLiveMarkdownOptions = {}
): LiveMarkdownRenderResult {
	const nowMs = options.nowMs ?? getNowMs;
	const startedAt = nowMs();

	const fencedCodeBlock =
		section.kind === "settled" ? parseFencedCodeBlock(section.markdown) : null;
	if (fencedCodeBlock) {
		const languageAttribute =
			fencedCodeBlock.language === null
				? ""
				: ` data-language="${escapeHtml(fencedCodeBlock.language)}"`;
		return {
			html: `<pre class="streaming-live-code"><code${languageAttribute}>${escapeHtml(fencedCodeBlock.code)}</code></pre>`,
			durationMs: nowMs() - startedAt,
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
		return { html: null, durationMs: nowMs() - startedAt };
	}

	return {
		html: renderPresentation(promotion.markdown, promotion.presentation),
		durationMs: nowMs() - startedAt,
	};
}
