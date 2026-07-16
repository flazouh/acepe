import { bashHighlighter } from "../../../../../utils/bash-highlighter.svelte.js";

export function splitExecuteCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	let index = 0;

	while (index < command.length) {
		const character = command[index];

		if (character === "\\" && index + 1 < command.length) {
			current += character + command[index + 1];
			index += 2;
			continue;
		}

		if (character === "'" && !inDouble) {
			inSingle = !inSingle;
			current += character;
			index += 1;
			continue;
		}

		if (character === '"' && !inSingle) {
			inDouble = !inDouble;
			current += character;
			index += 1;
			continue;
		}

		if (!inSingle && !inDouble) {
			if (character === "&" && index + 1 < command.length && command[index + 1] === "&") {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				index += 2;
				continue;
			}

			if (character === "|" && index + 1 < command.length && command[index + 1] === "|") {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				index += 2;
				continue;
			}

			if (character === "|") {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				index += 1;
				continue;
			}

			if (character === ";" && !(index + 1 < command.length && command[index + 1] === ";")) {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				index += 1;
				continue;
			}
		}

		current += character;
		index += 1;
	}

	const trimmed = current.trim();
	if (trimmed) segments.push(trimmed);
	return segments;
}

/**
 * Stable Shiki-backed command highlighter for execute tool cards.
 * Pass into the View as `highlightCommand` so `$derived` upgrades when ready flips.
 */
export function getExecuteCommandHighlighter(): (code: string) => string | null {
	return bashHighlighter.highlight;
}

/**
 * Stable Shiki-backed output highlighter (log grammar) for stdout/stderr.
 */
export function getExecuteOutputHighlighter(): (code: string) => string | null {
	return bashHighlighter.highlightOutput;
}
