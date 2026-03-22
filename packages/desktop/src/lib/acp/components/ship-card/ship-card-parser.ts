/**
 * Incremental XML parser for <ship> content blocks.
 *
 * Zero dependencies. Re-parses the full accumulated string on each call.
 * For payloads under ~5KB this takes <0.1ms — no need for incremental state.
 *
 * Uses indexOf-based scanning (not regex) to avoid backtracking edge cases.
 * Handles streaming: tags opened but not yet closed return partial text content.
 */

export interface ShipCardData {
	/** Commit message text, or null if tag hasn't appeared yet */
	commitMessage: string | null;
	/** PR title, or null if tag hasn't appeared yet */
	prTitle: string | null;
	/** PR description (markdown), or null if tag hasn't appeared yet */
	prDescription: string | null;
	/** Which field is currently being streamed (tag open but not closed) */
	activeField: TagName | null;
	/** Whether <ship> has been opened */
	started: boolean;
	/** Whether </ship> has been received */
	complete: boolean;
}

const TAGS = ["commit-message", "pr-title", "pr-description"] as const;
export type TagName = (typeof TAGS)[number];

const TAG_TO_FIELD: Record<
	TagName,
	keyof Pick<ShipCardData, "commitMessage" | "prTitle" | "prDescription">
> = {
	"commit-message": "commitMessage",
	"pr-title": "prTitle",
	"pr-description": "prDescription",
};

export function parseShipXml(raw: string): ShipCardData {
	const result: ShipCardData = {
		commitMessage: null,
		prTitle: null,
		prDescription: null,
		activeField: null,
		started: false,
		complete: false,
	};

	const shipOpen = raw.indexOf("<ship>");
	if (shipOpen === -1) return result;
	result.started = true;

	const shipClose = raw.indexOf("</ship>");
	result.complete = shipClose !== -1;

	const contentStart = shipOpen + "<ship>".length;
	const contentEnd = shipClose !== -1 ? shipClose : raw.length;
	const content = raw.slice(contentStart, contentEnd);

	for (const tag of TAGS) {
		const openTag = `<${tag}>`;
		const closeTag = `</${tag}>`;
		const field = TAG_TO_FIELD[tag];

		const openIdx = content.indexOf(openTag);
		if (openIdx === -1) continue;

		const textStart = openIdx + openTag.length;
		const closeIdx = content.indexOf(closeTag, textStart);

		if (closeIdx !== -1) {
			result[field] = content.slice(textStart, closeIdx);
		} else {
			// Tag open but not closed — partial streaming content
			let partialText = content.slice(textStart);
			// Strip trailing incomplete closing tag (e.g., "</pr-descrip")
			const trailingClose = partialText.lastIndexOf("</");
			if (trailingClose !== -1 && !partialText.slice(trailingClose).includes(">")) {
				partialText = partialText.slice(0, trailingClose);
			}
			result[field] = partialText;
			result.activeField = tag;
		}
	}

	return result;
}
