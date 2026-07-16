/**
 * Cap for Shiki highlighting volume.
 *
 * Small snippets highlight in a few ms with the warmed singleton. Large files
 * (thousands of lines) can spend ~180ms on the main thread. Beyond this cap we
 * skip Shiki and render plain text.
 */
export const SYNTAX_HIGHLIGHT_MAX_LINES = 200;
export const SYNTAX_HIGHLIGHT_MAX_BYTES = 20_480;

export function exceedsSyntaxHighlightCap(code: string): boolean {
	if (code.length > SYNTAX_HIGHLIGHT_MAX_BYTES) {
		return true;
	}

	let lineCount = 1;
	for (let index = 0; index < code.length; index += 1) {
		if (code.charCodeAt(index) === 10) {
			lineCount += 1;
			if (lineCount > SYNTAX_HIGHLIGHT_MAX_LINES) {
				return true;
			}
		}
	}

	return false;
}
