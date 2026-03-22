/**
 * Known thought prefixes that agents may add to thought chunks.
 *
 * These prefixes are added by some agent adapters (like cursor-agent-acp) to
 * visually distinguish thought content in terminal/CLI output. Since the ACP
 * protocol already semantically distinguishes thought chunks via the
 * `agentThoughtChunk` message type, these prefixes are redundant in our UI.
 */
export const THOUGHT_PREFIXES = [
	"[Thinking]",
	"[thinking]",
	"[THINKING]",
	"[Thought]",
	"[thought]",
	"[THOUGHT]",
] as const;

/**
 * Regular expression pattern to match thought prefixes at the start of text.
 *
 * Pattern breakdown:
 * - `^\s*` - Match start of string with optional leading whitespace
 * - `\[(Thinking|thinking|THINKING|Thought|thought|THOUGHT)\]` - Match the prefix
 * - `\s*` - Match optional trailing whitespace after the prefix
 *
 * Using case-sensitive alternation instead of `i` flag for precise control.
 */
const THOUGHT_PREFIX_PATTERN = /^\s*\[(Thinking|thinking|THINKING|Thought|thought|THOUGHT)\]\s*/;

/**
 * Check if text starts with a known thought prefix.
 *
 * @param text - The text content to check
 * @returns True if the text starts with a thought prefix
 *
 * @example
 * hasThoughtPrefix("[Thinking] I should read the file first.")
 * // Returns: true
 *
 * @example
 * hasThoughtPrefix("Some regular text.")
 * // Returns: false
 */
export function hasThoughtPrefix(text: string): boolean {
	return THOUGHT_PREFIX_PATTERN.test(text);
}

/**
 * Strip known thought prefixes from text content.
 *
 * This function removes redundant thought indicator prefixes that some agent
 * adapters add to thought content. The prefix is only stripped if it appears
 * at the beginning of the text (with optional leading whitespace).
 *
 * @param text - The text content to process
 * @returns The text with any thought prefix removed
 *
 * @example
 * stripThoughtPrefix("[Thinking] I should read the file first.")
 * // Returns: "I should read the file first."
 *
 * @example
 * stripThoughtPrefix("Some text [Thinking] in middle.")
 * // Returns: "Some text [Thinking] in middle." (unchanged)
 */
export function stripThoughtPrefix(text: string): string {
	return text.replace(THOUGHT_PREFIX_PATTERN, "");
}
