const FALLBACK_SESSION_TITLES = new Set(["New Thread", "New session", "New Session", "Loading..."]);
const GENERATED_SESSION_TITLE_PATTERN = /^Session [a-f0-9-]{6,}$/i;
const MAX_DERIVED_TITLE_CHARS = 100;
/** Matches complete `@[type:value]` tokens and incomplete ones truncated without closing `]`. */
const INLINE_TOKEN_PATTERN = /@\[(file|image|text|text_ref|command|skill):[^\]]+\]?/;

/**
 * Strips system artifacts and metadata tags from session titles.
 * Removes patterns like <ide_opened_file>...</ide_opened_file> and similar XML-style tags.
 */
export function stripArtifactsFromTitle(title: string): string {
	let cleaned = title;
	// Strip all XML-style tag pairs: <tag_name ...>content</tag_name> or orphan <tag_name ...>content-to-end
	// This handles ide_*, git_status, user_info, system-reminder, pasted-content, environment_context, etc.
	const xmlTagPattern = /<([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>[\s\S]*?(?:<\/\1[^>]*>|(?=<[a-zA-Z])|$)/g;
	// Apply repeatedly until stable (handles sequential tags)
	let prev = "";
	while (cleaned !== prev) {
		prev = cleaned;
		cleaned = cleaned.replace(xmlTagPattern, "");
	}
	cleaned = cleaned
		// Match attachment tokens: @[file:...], @[image:...], @[text:...], @[command:...], @[skill:...]
		// Also matches truncated tokens missing closing ] (e.g. from title truncation)
		.replace(/@\[(file|image|text|command|skill):[^\]]+\]?/g, "")
		// Match expanded attachment refs: [Attached image: ...], [Attached file: ...]
		.replace(/\[Attached (?:image|file|PDF): [^\]]+\]/g, "")
		.trim();

	return cleaned;
}

/**
 * Strips XML tags and expanded attachment refs from a title, but preserves
 * inline `@[type:value]` tokens so they can be rendered as visual chips.
 */
export function stripXmlArtifactsFromTitle(title: string): string {
	let cleaned = title;
	const xmlTagPattern = /<([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>[\s\S]*?(?:<\/\1[^>]*>|(?=<[a-zA-Z])|$)/g;
	let prev = "";
	while (cleaned !== prev) {
		prev = cleaned;
		cleaned = cleaned.replace(xmlTagPattern, "");
	}
	cleaned = cleaned
		// Strip expanded attachment refs but keep @[type:value] tokens
		.replace(/\[Attached (?:image|file|PDF): [^\]]+\]/g, "")
		// Collapse literal \n and real newlines into spaces
		.replace(/\\n/g, " ")
		.replace(/\r?\n/g, " ")
		.trim();

	return cleaned;
}

/**
 * Returns true when the title contains at least one inline artefact token.
 */
export function titleHasInlineTokens(title: string): boolean {
	return INLINE_TOKEN_PATTERN.test(title);
}

/**
 * Format a session title for rich display, returning both the token-preserved
 * title for chip rendering and the plain text for tooltip/accessibility.
 *
 * `richText` is non-null when the title contains `@[type:value]` tokens
 * that should be rendered as chips. `plainText` is always the fully-stripped
 * display title (same as `formatSessionTitleForDisplay`).
 */
export function formatRichSessionTitle(
	title: string | null | undefined,
	projectName?: string | null,
	unknownProjectName?: string
): { richText: string | null; plainText: string } {
	const plainText = formatSessionTitleForDisplay(title, projectName, unknownProjectName);

	if (!title) {
		return { richText: null, plainText };
	}

	const semiCleaned = stripXmlArtifactsFromTitle(title);
	if (semiCleaned === "" || !titleHasInlineTokens(semiCleaned)) {
		return { richText: null, plainText };
	}

	// Capitalize the first non-token text character
	const capitalized = capitalizeRichTitle(semiCleaned);
	return { richText: capitalized, plainText };
}

/**
 * Capitalize the first text character in a string that may start with
 * `@[type:value]` tokens. Tokens are skipped so that "fix bug" becomes
 * "Fix bug" even when preceded by "@[file:/a.ts] ".
 */
function capitalizeRichTitle(text: string): string {
	// Find first character that isn't part of a token
	let i = 0;
	while (i < text.length) {
		// Skip tokens
		if (text[i] === "@" && text[i + 1] === "[") {
			const closingBracket = text.indexOf("]", i + 2);
			if (closingBracket !== -1) {
				i = closingBracket + 1;
				continue;
			}
		}
		// Skip whitespace
		if (text[i] === " ") {
			i++;
			continue;
		}
		// Found a non-token, non-whitespace character — capitalize it
		return text.slice(0, i) + text[i].toUpperCase() + text.slice(i + 1);
	}
	return text;
}

/**
 * Normalize a title for display: strip artifacts, collapse newlines and literal "\n" so e.g. "\nhi\n" shows as "hi".
 * Use this when rendering session titles in the UI.
 */
export function normalizeTitleForDisplay(title: string): string {
	return stripArtifactsFromTitle(title).replace(/\\n/g, " ").replace(/\r?\n/g, " ").trim();
}

function capitalizeTitle(text: string): string {
	if (text.length === 0) return text;
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Format a session title for user-facing display, including the standard
 * fallback title when no real title is present.
 */
export function formatSessionTitleForDisplay(
	title: string | null | undefined,
	projectName?: string | null,
	unknownProjectName?: string
): string {
	const cleanedTitle = normalizeTitleForDisplay(title ? title : "");
	if (cleanedTitle !== "") {
		return capitalizeTitle(cleanedTitle);
	}

	const effectiveProjectName = projectName ? projectName : null;
	const excludedProjectName = unknownProjectName ? unknownProjectName : "Unknown";
	if (effectiveProjectName && effectiveProjectName !== excludedProjectName) {
		return capitalizeTitle(`Conversation in ${effectiveProjectName}`);
	}

	return "Untitled conversation";
}

/**
 * Returns true when a title is still a placeholder and safe to replace.
 */
export function isFallbackSessionTitle(title: string): boolean {
	const trimmedTitle = title.trim();
	return (
		FALLBACK_SESSION_TITLES.has(trimmedTitle) || GENERATED_SESSION_TITLE_PATTERN.test(trimmedTitle)
	);
}

/**
 * Derive a user-facing title from the first meaningful line of user input.
 */
export function deriveSessionTitleFromUserInput(input: string): string | null {
	const cleaned = stripArtifactsFromTitle(input);
	const trimmed = cleaned.trim();
	if (trimmed.length === 0 || trimmed.startsWith("/")) {
		return null;
	}

	const firstLine = trimmed.split(/\r?\n/u)[0]?.trim() ?? "";
	if (firstLine.length === 0) {
		return null;
	}

	const chars = Array.from(firstLine);
	if (chars.length <= MAX_DERIVED_TITLE_CHARS) {
		return firstLine;
	}

	return `${chars.slice(0, MAX_DERIVED_TITLE_CHARS).join("")}...`;
}

/**
 * Determine whether the current title should be updated from a user message.
 */
export function getTitleUpdateFromUserMessage(
	currentTitle: string,
	userMessage: string
): string | null {
	// Treat titles as fallback if they're known fallback titles OR if they become empty after stripping artifacts
	const strippedTitle = stripArtifactsFromTitle(currentTitle).trim();
	const isKnownFallback = isFallbackSessionTitle(currentTitle);
	const isArtifactOnlyTitle = strippedTitle === "" && currentTitle.trim() !== "";
	const isFallback = isKnownFallback || isArtifactOnlyTitle;

	if (!isFallback) {
		return null;
	}

	return deriveSessionTitleFromUserInput(userMessage);
}
