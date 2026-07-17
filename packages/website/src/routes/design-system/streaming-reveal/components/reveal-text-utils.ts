/**
 * Pure text-splitting helpers shared by the buffer-fade and block-fade
 * renderers. Both need to slice already-visible text into stable,
 * index-keyed chunks so a Svelte `{#each ... (index)}` only mounts (and
 * therefore only fades) freshly-appended chunks — never replays a fade on
 * text that was already on screen.
 */

/** Non-whitespace run plus its trailing whitespace — tokens rejoin to the exact source text. */
const WORD_TOKEN_PATTERN = /\S+\s*/g;

/** Splits `text` into word tokens (each token keeps its trailing whitespace/newline). */
export function splitIntoWordTokens(text: string): readonly string[] {
	return text.match(WORD_TOKEN_PATTERN) ?? [];
}

export interface TextBlock {
	readonly text: string;
	readonly isCode: boolean;
}

const FENCE_PATTERN = /^\s*```/;

/**
 * Splits `text` into blank-line-separated blocks, treating a fenced
 * ```code``` span (including any blank lines inside it) as one block.
 *
 * Streaming caveat: the LAST element may be incomplete — it was flushed by
 * running out of text, not by a following blank line. Callers that render
 * incrementally should hold that last block back until either another
 * block appears after it (this function returns one more element) or the
 * stream is done.
 */
export function splitIntoBlocks(text: string): readonly TextBlock[] {
	const lines = text.split("\n");
	const blocks: TextBlock[] = [];
	let current: string[] = [];
	let currentIsCode = false;
	let inFence = false;

	function flush(): void {
		if (current.length === 0) return;
		blocks.push({ text: current.join("\n"), isCode: currentIsCode });
		current = [];
		currentIsCode = false;
	}

	for (const line of lines) {
		if (FENCE_PATTERN.test(line)) {
			if (inFence) {
				current.push(line);
				inFence = false;
				continue;
			}
			flush();
			inFence = true;
			currentIsCode = true;
			current.push(line);
			continue;
		}
		if (inFence) {
			current.push(line);
			continue;
		}
		if (line.trim().length === 0) {
			flush();
			continue;
		}
		current.push(line);
	}
	flush();

	return blocks;
}
