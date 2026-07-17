import { marked, type Token, type Tokens } from "marked";

import { extensionToIcon } from "../../lib/file-icon/index.js";

const KNOWN_FILE_EXTENSION_GROUP = Object.keys(extensionToIcon)
	.map((extension) => extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	.join("|");

const FILE_REFERENCE_WITH_LOCATION_PATTERN = /^(?<path>.+?):(?<line>\d+)(?::(?<column>\d+))?$/u;
const FILE_PATH_IN_TEXT_PATTERN = new RegExp(
	`(?<!\\S)(\\/?(?:[^/\\s]+\\/)+[^/\\s]+\\.(?:${KNOWN_FILE_EXTENSION_GROUP})(?::\\d+(?::\\d+)?)?)(?!\\S)`,
	"giu",
);
const KNOWN_FILE_EXTENSION_PATTERN = new RegExp(
	`(?:^|/)[^/\\s]+\\.(?:${KNOWN_FILE_EXTENSION_GROUP})(?::\\d+(?::\\d+)?)?$`,
	"iu",
);
const GITHUB_PR_SHORTHAND_PATTERN = /\b([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)#(\d+)\b/gu;
const GITHUB_URL_PATTERN =
	/https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/(pull|issues?)\/(\d+)/giu;
const GITHUB_REF_URL_PATTERN =
	/^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/(pull|issues?)\/(\d+)$/u;
const BLOCKED_URL_PROTOCOL_PATTERN = /^(?:javascript|data|file|blob|vbscript):/iu;
const URL_PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
const TEXT_PART_PATTERN = /(\s+|[^\s]+)/gu;
const CODE_FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;

export interface NativeMarkdownDocument {
	readonly blocks: readonly NativeMarkdownBlock[];
	readonly wordCount: number;
}

export type NativeMarkdownBlock =
	| NativeMarkdownTextBlock
	| NativeMarkdownParagraphBlock
	| NativeMarkdownHeadingBlock
	| NativeMarkdownCodeBlock
	| NativeMarkdownListBlock
	| NativeMarkdownBlockquoteBlock
	| NativeMarkdownTableBlock
	| NativeMarkdownHrBlock;

export interface NativeMarkdownTextBlock {
	readonly type: "text";
	readonly key: string;
	readonly children: readonly NativeMarkdownInline[];
}

export interface NativeMarkdownParagraphBlock {
	readonly type: "paragraph";
	readonly key: string;
	readonly children: readonly NativeMarkdownInline[];
}

export interface NativeMarkdownHeadingBlock {
	readonly type: "heading";
	readonly key: string;
	readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
	readonly children: readonly NativeMarkdownInline[];
}

export interface NativeMarkdownCodeBlock {
	readonly type: "code";
	readonly key: string;
	readonly code: string;
	readonly language: string;
	readonly meta: string;
	readonly isIncomplete: boolean;
}

export interface NativeMarkdownListBlock {
	readonly type: "list";
	readonly key: string;
	readonly ordered: boolean;
	readonly start: number | null;
	readonly items: readonly NativeMarkdownListItem[];
}

export interface NativeMarkdownListItem {
	readonly key: string;
	readonly task: boolean;
	readonly checked: boolean | null;
	readonly blocks: readonly NativeMarkdownBlock[];
}

export interface NativeMarkdownBlockquoteBlock {
	readonly type: "blockquote";
	readonly key: string;
	readonly blocks: readonly NativeMarkdownBlock[];
}

export interface NativeMarkdownTableBlock {
	readonly type: "table";
	readonly key: string;
	readonly align: readonly NativeMarkdownTableAlign[];
	readonly header: readonly NativeMarkdownTableCell[];
	readonly rows: readonly (readonly NativeMarkdownTableCell[])[];
}

export type NativeMarkdownTableAlign = "left" | "center" | "right" | null;

export interface NativeMarkdownTableCell {
	readonly key: string;
	readonly align: NativeMarkdownTableAlign;
	readonly children: readonly NativeMarkdownInline[];
}

export interface NativeMarkdownHrBlock {
	readonly type: "hr";
	readonly key: string;
}

export type NativeMarkdownInline =
	| NativeMarkdownTextInline
	| NativeMarkdownCodeInline
	| NativeMarkdownLinkInline
	| NativeMarkdownStrongInline
	| NativeMarkdownEmInline
	| NativeMarkdownDeleteInline
	| NativeMarkdownLineBreakInline;

export interface NativeMarkdownTextInline {
	readonly type: "text";
	readonly key: string;
	readonly parts: readonly NativeMarkdownTextPart[];
}

export type NativeMarkdownTextPart =
	| NativeMarkdownSpacePart
	| NativeMarkdownWordPart;

export interface NativeMarkdownSpacePart {
	readonly type: "space";
	readonly key: string;
	readonly text: string;
}

export interface NativeMarkdownWordPart {
	readonly type: "word";
	readonly key: string;
	readonly text: string;
	readonly wordIndex: number;
}

export interface NativeMarkdownCodeInline {
	readonly type: "code";
	readonly key: string;
	readonly text: string;
}

export interface NativeMarkdownLinkInline {
	readonly type: "link";
	readonly key: string;
	readonly href: string | null;
	readonly label: string;
	readonly children: readonly NativeMarkdownInline[];
}

export interface NativeMarkdownStrongInline {
	readonly type: "strong";
	readonly key: string;
	readonly children: readonly NativeMarkdownInline[];
}

export interface NativeMarkdownEmInline {
	readonly type: "em";
	readonly key: string;
	readonly children: readonly NativeMarkdownInline[];
}

export interface NativeMarkdownDeleteInline {
	readonly type: "delete";
	readonly key: string;
	readonly children: readonly NativeMarkdownInline[];
}

export interface NativeMarkdownLineBreakInline {
	readonly type: "line_break";
	readonly key: string;
}

export interface GitHubChipRef {
	readonly owner: string;
	readonly repo: string;
	readonly number: number;
	readonly isPullRequest: boolean;
}

interface ParseCursor {
	nextKey: number;
	wordIndex: number;
}

interface InlineReferenceMatch {
	readonly index: number;
	readonly endIndex: number;
	readonly label: string;
	readonly href: string;
	readonly kind: "file" | "github";
}

export function parseNativeMarkdown(markdown: string): NativeMarkdownDocument {
	const cursor: ParseCursor = {
		nextKey: 0,
		wordIndex: 0,
	};
	const tokens = marked.lexer(markdown, {
		gfm: true,
		breaks: false,
	});
	const blocks: NativeMarkdownBlock[] = [];

	for (const token of tokens) {
		const block = normalizeBlockToken(token, cursor);
		if (block !== null) {
			blocks.push(block);
		}
	}

	return {
		blocks,
		wordCount: cursor.wordIndex,
	};
}

export function sanitizeMarkdownHref(href: string): string | null {
	const trimmedHref = href.trim();
	if (BLOCKED_URL_PROTOCOL_PATTERN.test(trimmedHref)) {
		return null;
	}

	if (trimmedHref.startsWith("http://") || trimmedHref.startsWith("https://")) {
		if (typeof URL.canParse === "function" && URL.canParse(trimmedHref)) {
			return new URL(trimmedHref).toString();
		}
		return trimmedHref;
	}

	if (URL_PROTOCOL_PATTERN.test(trimmedHref) && !trimmedHref.startsWith("mailto:")) {
		return null;
	}

	return trimmedHref;
}

export function isExternalUrl(href: string): boolean {
	return href.startsWith("http://") || href.startsWith("https://");
}

export function normalizeLocalFileHref(href: string): string {
	const [path, fragment] = href.split("#", 2);
	const lineMatch = fragment?.match(/^L(\d+)$/u);
	if (path !== undefined && lineMatch?.[1] !== undefined) {
		return `${path}:${lineMatch[1]}`;
	}
	return href;
}

export function isLocalFileReference(href: string): boolean {
	if (isExternalUrl(href) || href.startsWith("#") || href.startsWith("mailto:")) {
		return false;
	}

	return KNOWN_FILE_EXTENSION_PATTERN.test(normalizeLocalFileHref(href));
}

export function getFileDisplayName(fileReference: string): string {
	const match = FILE_REFERENCE_WITH_LOCATION_PATTERN.exec(fileReference);
	if (!match?.groups?.path || !match.groups.line) {
		return fileReference.split("/").pop() ?? fileReference;
	}

	const path = match.groups.path;
	const line = match.groups.line;
	const column = match.groups.column;
	const fileName = path.split("/").pop() ?? path;
	return column ? `${fileName}:${line}:${column}` : `${fileName}:${line}`;
}

export function isGitHubUrl(href: string): boolean {
	return /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(?:pull|issues?)\/\d+$/u.test(
		href,
	);
}

export function parseGitHubChipRef(href: string): GitHubChipRef | null {
	const match = GITHUB_REF_URL_PATTERN.exec(href);
	if (match === null) {
		return null;
	}

	const [, owner, repo, refType, numberText] = match;
	if (
		owner === undefined ||
		repo === undefined ||
		refType === undefined ||
		numberText === undefined
	) {
		return null;
	}

	const parsedNumber = Number.parseInt(numberText, 10);
	if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
		return null;
	}

	return {
		owner,
		repo,
		number: parsedNumber,
		isPullRequest: refType === "pull",
	};
}

function normalizeBlockToken(token: Token, cursor: ParseCursor): NativeMarkdownBlock | null {
	switch (token.type) {
		case "space":
		case "def":
		case "html":
			return null;
		case "hr":
			return {
				type: "hr",
				key: nextKey(cursor, "hr"),
			};
		case "code":
			if (!isCodeToken(token)) return null;
			return normalizeCodeBlock(token, cursor);
		case "heading":
			if (!isHeadingToken(token)) return null;
			return {
				type: "heading",
				key: nextKey(cursor, "heading"),
				depth: normalizeHeadingDepth(token.depth),
				children: normalizeInlineTokens(token.tokens, cursor),
			};
		case "paragraph":
			if (!isParagraphToken(token)) return null;
			return {
				type: "paragraph",
				key: nextKey(cursor, "paragraph"),
				children: normalizeInlineTokens(token.tokens, cursor),
			};
		case "text":
			if (!isTextToken(token)) return null;
			return {
				type: "text",
				key: nextKey(cursor, "text-block"),
				children: normalizeTextTokenInlineChildren(token, cursor),
			};
		case "blockquote":
			if (!isBlockquoteToken(token)) return null;
			return {
				type: "blockquote",
				key: nextKey(cursor, "blockquote"),
				blocks: normalizeBlockTokens(token.tokens, cursor),
			};
		case "list":
			if (!isListToken(token)) return null;
			return normalizeListBlock(token, cursor);
		case "table":
			if (!isTableToken(token)) return null;
			return normalizeTableBlock(token, cursor);
		default:
			return null;
	}
}

function normalizeBlockTokens(
	tokens: readonly Token[],
	cursor: ParseCursor,
): readonly NativeMarkdownBlock[] {
	const blocks: NativeMarkdownBlock[] = [];
	for (const token of tokens) {
		const block = normalizeBlockToken(token, cursor);
		if (block !== null) {
			blocks.push(block);
		}
	}
	return blocks;
}

function isCodeToken(token: Token): token is Tokens.Code {
	return token.type === "code" && "text" in token;
}

function isHeadingToken(token: Token): token is Tokens.Heading {
	return token.type === "heading" && "depth" in token && Array.isArray(token.tokens);
}

function isParagraphToken(token: Token): token is Tokens.Paragraph {
	return token.type === "paragraph" && Array.isArray(token.tokens);
}

function isTextToken(token: Token): token is Tokens.Text {
	return token.type === "text" && "text" in token;
}

function isBlockquoteToken(token: Token): token is Tokens.Blockquote {
	return token.type === "blockquote" && Array.isArray(token.tokens);
}

function isListToken(token: Token): token is Tokens.List {
	return token.type === "list" && Array.isArray(token.items);
}

function isTableToken(token: Token): token is Tokens.Table {
	return token.type === "table" && Array.isArray(token.header) && Array.isArray(token.rows);
}

function isLinkToken(token: Token): token is Tokens.Link {
	return token.type === "link" && "href" in token && "text" in token && Array.isArray(token.tokens);
}

function isStrongToken(token: Token): token is Tokens.Strong {
	return token.type === "strong" && Array.isArray(token.tokens);
}

function isEmToken(token: Token): token is Tokens.Em {
	return token.type === "em" && Array.isArray(token.tokens);
}

function isDeleteToken(token: Token): token is Tokens.Del {
	return token.type === "del" && Array.isArray(token.tokens);
}

function normalizeCodeBlock(token: Tokens.Code, cursor: ParseCursor): NativeMarkdownCodeBlock {
	const info = token.lang ?? "";
	const firstSpaceIndex = info.search(/\s/u);
	const language = firstSpaceIndex === -1 ? info : info.slice(0, firstSpaceIndex);
	const meta = firstSpaceIndex === -1 ? "" : info.slice(firstSpaceIndex + 1).trim();
	const fenceMatch = CODE_FENCE_PATTERN.exec(token.raw);
	const fence = fenceMatch?.[1];
	const isIncomplete = fence !== undefined && !token.raw.trimEnd().endsWith(fence);

	return {
		type: "code",
		key: nextKey(cursor, "code"),
		code: token.text,
		language,
		meta,
		isIncomplete,
	};
}

function normalizeHeadingDepth(depth: number): 1 | 2 | 3 | 4 | 5 | 6 {
	if (depth <= 1) return 1;
	if (depth === 2) return 2;
	if (depth === 3) return 3;
	if (depth === 4) return 4;
	if (depth === 5) return 5;
	return 6;
}

function normalizeTextTokenInlineChildren(
	token: Tokens.Text,
	cursor: ParseCursor,
): readonly NativeMarkdownInline[] {
	if (token.tokens !== undefined) {
		return normalizeInlineTokens(token.tokens, cursor);
	}
	return createInlineTokensFromText(token.text, cursor);
}

function normalizeListBlock(token: Tokens.List, cursor: ParseCursor): NativeMarkdownListBlock {
	const items: NativeMarkdownListItem[] = [];
	for (const item of token.items) {
		items.push({
			key: nextKey(cursor, "list-item"),
			task: item.task,
			checked: item.checked ?? null,
			blocks: normalizeBlockTokens(item.tokens, cursor),
		});
	}

	return {
		type: "list",
		key: nextKey(cursor, "list"),
		ordered: token.ordered,
		start: typeof token.start === "number" ? token.start : null,
		items,
	};
}

function normalizeTableBlock(token: Tokens.Table, cursor: ParseCursor): NativeMarkdownTableBlock {
	const header: NativeMarkdownTableCell[] = [];
	for (let index = 0; index < token.header.length; index += 1) {
		const cell = token.header[index];
		if (cell === undefined) {
			continue;
		}
		header.push(normalizeTableCell(cell, token.align[index] ?? null, cursor));
	}

	const rows: NativeMarkdownTableCell[][] = [];
	for (const row of token.rows) {
		const nextRow: NativeMarkdownTableCell[] = [];
		for (let index = 0; index < row.length; index += 1) {
			const cell = row[index];
			if (cell === undefined) {
				continue;
			}
			nextRow.push(normalizeTableCell(cell, token.align[index] ?? null, cursor));
		}
		rows.push(nextRow);
	}

	return {
		type: "table",
		key: nextKey(cursor, "table"),
		align: token.align,
		header,
		rows,
	};
}

function normalizeTableCell(
	cell: Tokens.TableCell,
	align: NativeMarkdownTableAlign,
	cursor: ParseCursor,
): NativeMarkdownTableCell {
	return {
		key: nextKey(cursor, "table-cell"),
		align,
		children: normalizeInlineTokens(cell.tokens, cursor),
	};
}

function normalizeInlineTokens(
	tokens: readonly Token[],
	cursor: ParseCursor,
): readonly NativeMarkdownInline[] {
	const inlines: NativeMarkdownInline[] = [];
	for (const token of tokens) {
		for (const inline of normalizeInlineToken(token, cursor)) {
			inlines.push(inline);
		}
	}
	return inlines;
}

function normalizeInlineToken(
	token: Token,
	cursor: ParseCursor,
): readonly NativeMarkdownInline[] {
	switch (token.type) {
		case "escape":
			return createInlineTokensFromText(token.text, cursor);
		case "text":
			if (!isTextToken(token)) return [];
			return normalizeTextTokenInlineChildren(token, cursor);
		case "codespan":
			return [
				{
					type: "code",
					key: nextKey(cursor, "inline-code"),
					text: normalizeLocalFileHref(token.text),
				},
			];
		case "link":
			if (!isLinkToken(token)) return [];
			return [normalizeLinkInline(token, cursor)];
		case "strong":
			if (!isStrongToken(token)) return [];
			return [
				{
					type: "strong",
					key: nextKey(cursor, "strong"),
					children: normalizeInlineTokens(token.tokens, cursor),
				},
			];
		case "em":
			if (!isEmToken(token)) return [];
			return [
				{
					type: "em",
					key: nextKey(cursor, "em"),
					children: normalizeInlineTokens(token.tokens, cursor),
				},
			];
		case "del":
			if (!isDeleteToken(token)) return [];
			return [
				{
					type: "delete",
					key: nextKey(cursor, "delete"),
					children: normalizeInlineTokens(token.tokens, cursor),
				},
			];
		case "br":
			return [
				{
					type: "line_break",
					key: nextKey(cursor, "line-break"),
				},
			];
		case "image":
			return createInlineTokensFromText(token.text, cursor);
		case "html":
			return [];
		default:
			return [];
	}
}

function normalizeLinkInline(token: Tokens.Link, cursor: ParseCursor): NativeMarkdownLinkInline {
	const href = sanitizeMarkdownHref(token.href);
	const children = normalizeInlineTokens(token.tokens, cursor);
	return {
		type: "link",
		key: nextKey(cursor, "link"),
		href,
		label: token.text,
		children,
	};
}

function createInlineTokensFromText(
	text: string,
	cursor: ParseCursor,
): readonly NativeMarkdownInline[] {
	const matches = collectInlineReferenceMatches(text);
	if (matches.length === 0) {
		return [createTextInline(text, cursor)];
	}

	const inlines: NativeMarkdownInline[] = [];
	let lastIndex = 0;
	for (const match of matches) {
		if (match.index > lastIndex) {
			inlines.push(createTextInline(text.slice(lastIndex, match.index), cursor));
		}

		if (match.kind === "file") {
			inlines.push({
				type: "code",
				key: nextKey(cursor, "inline-code"),
				text: normalizeLocalFileHref(match.href),
			});
		} else {
			inlines.push({
				type: "link",
				key: nextKey(cursor, "link"),
				href: sanitizeMarkdownHref(match.href),
				label: match.label,
				children: [createTextInline(match.label, cursor)],
			});
		}

		lastIndex = match.endIndex;
	}

	if (lastIndex < text.length) {
		inlines.push(createTextInline(text.slice(lastIndex), cursor));
	}

	return inlines;
}

function createTextInline(text: string, cursor: ParseCursor): NativeMarkdownTextInline {
	const parts: NativeMarkdownTextPart[] = [];
	let firstWordIndex: number | null = null;
	TEXT_PART_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = TEXT_PART_PATTERN.exec(text)) !== null) {
		const partText = match[0];
		if (/^\s+$/u.test(partText)) {
			parts.push({
				type: "space",
				key: nextKey(cursor, "space"),
				text: partText,
			});
		} else {
			const wordIndex = cursor.wordIndex;
			if (firstWordIndex === null) {
				firstWordIndex = wordIndex;
			}
			cursor.wordIndex += 1;
			parts.push({
				type: "word",
				// Keyed by document word position only — NOT the text. A streaming tail
				// word grows char by char; keeping the key stable lets Svelte update the
				// span's text in place instead of re-mounting it every keystroke (which
				// would restart the mount-driven reveal fade and flicker the leading
				// word). wordIndex is a document-global counter, unique per word.
				key: `word:${wordIndex}`,
				text: partText,
				wordIndex,
			});
		}
	}

	return {
		type: "text",
		// Anchor the key to the first word's document position, NOT a running
		// nextKey counter. The counter increments for every space/mark before this
		// key is minted, so it shifts each time the paragraph grows a word — which
		// re-keys the text inline and remounts every word span under it (restarting
		// each word's reveal fade → flicker). firstWordIndex is stable as a
		// paragraph streams in, so its inline subtree is reconciled in place.
		key: firstWordIndex === null ? nextKey(cursor, "text") : `text:${firstWordIndex}`,
		parts,
	};
}

function collectInlineReferenceMatches(text: string): readonly InlineReferenceMatch[] {
	const matches: InlineReferenceMatch[] = [];

	GITHUB_URL_PATTERN.lastIndex = 0;
	let githubUrlMatch: RegExpExecArray | null;
	while ((githubUrlMatch = GITHUB_URL_PATTERN.exec(text)) !== null) {
		const [full, owner, repo, refType, number] = githubUrlMatch;
		if (
			full === undefined ||
			owner === undefined ||
			repo === undefined ||
			refType === undefined ||
			number === undefined
		) {
			continue;
		}
		const label = `${owner}/${repo}#${number}`;
		const route = refType === "pull" ? "pull" : "issues";
		matches.push({
			index: githubUrlMatch.index,
			endIndex: githubUrlMatch.index + full.length,
			label,
			href: `https://github.com/${owner}/${repo}/${route}/${number}`,
			kind: "github",
		});
	}

	GITHUB_PR_SHORTHAND_PATTERN.lastIndex = 0;
	let githubShorthandMatch: RegExpExecArray | null;
	while ((githubShorthandMatch = GITHUB_PR_SHORTHAND_PATTERN.exec(text)) !== null) {
		const [full, owner, repo, number] = githubShorthandMatch;
		if (
			full === undefined ||
			owner === undefined ||
			repo === undefined ||
			number === undefined
		) {
			continue;
		}
		matches.push({
			index: githubShorthandMatch.index,
			endIndex: githubShorthandMatch.index + full.length,
			label: full,
			href: `https://github.com/${owner}/${repo}/pull/${number}`,
			kind: "github",
		});
	}

	FILE_PATH_IN_TEXT_PATTERN.lastIndex = 0;
	let filePathMatch: RegExpExecArray | null;
	while ((filePathMatch = FILE_PATH_IN_TEXT_PATTERN.exec(text)) !== null) {
		const [full] = filePathMatch;
		if (full === undefined) {
			continue;
		}
		matches.push({
			index: filePathMatch.index,
			endIndex: filePathMatch.index + full.length,
			label: getFileDisplayName(full),
			href: full,
			kind: "file",
		});
	}

	return matches
		.sort((a, b) => a.index - b.index)
		.filter((match, index, sortedMatches) => {
			const previous = sortedMatches[index - 1];
			return previous === undefined || match.index >= previous.endIndex;
		});
}

function nextKey(cursor: ParseCursor, prefix: string): string {
	const key = `${prefix}:${cursor.nextKey}`;
	cursor.nextKey += 1;
	return key;
}
