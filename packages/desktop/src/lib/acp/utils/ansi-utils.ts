/**
 * Utilities for handling ANSI escape codes in terminal output.
 */

/**
 * Regular expression to match ANSI escape codes.
 * This pattern matches:
 * - \u001b[...m - ANSI color/formatting codes (SGR)
 * - \u001b[...K - ANSI erase codes
 * - \u001b[...J - ANSI clear codes
 * - And other common ANSI sequences
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC character for ANSI detection
const ANSI_REGEX = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Strips ANSI escape codes from a string.
 *
 * @param text - The text containing ANSI escape codes
 * @returns The text with ANSI escape codes removed
 */
export function stripAnsiCodes(text: string): string {
	return text.replace(ANSI_REGEX, "");
}
