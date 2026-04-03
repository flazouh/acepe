const FALLBACK_SESSION_TITLES = new Set(["New Thread", "New session", "New Session", "Loading..."]);
const GENERATED_SESSION_TITLE_PATTERN = /^Session [a-f0-9-]{6,}$/i;
const MAX_DERIVED_TITLE_CHARS = 100;

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
		.replace(/@\[(file|image|text|command|skill):[^\]]+\]/g, "")
		// Match expanded attachment refs: [Attached image: ...], [Attached file: ...]
		.replace(/\[Attached (?:image|file|PDF): [^\]]+\]/g, "")
		.trim();

	return cleaned;
}

/**
 * Normalize a title for display: strip artifacts, collapse newlines and literal "\n" so e.g. "\nhi\n" shows as "hi".
 * Use this when rendering session titles in the UI.
 */
export function normalizeTitleForDisplay(title: string): string {
	return stripArtifactsFromTitle(title).replace(/\\n/g, " ").replace(/\r?\n/g, " ").trim();
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
