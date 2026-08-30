import type { Schema } from "effect";
import type { ToolArguments } from "../../services/acp-types.js";
import type { EditEntry, JsonValue } from "../../services/converted-session-types.js";
import { normalizeEditEntry } from "./aggregate-file-edits.js";

/**
 * Projects a tool call's canonical arguments into the shape the tool cards
 * read. The live bridge and the reopen path both need it and used to hold one
 * copy each, which is how the live path and a reopened session drift apart.
 *
 * Only the kinds a card actually reads are shaped; anything else travels raw,
 * since only the tool that produced it knows what its arguments mean.
 * `normalizeEditEntry` is shared with aggregate-file-edits so the key names a
 * provider might use live in exactly one place.
 */
export const noToolArguments: ToolArguments = { kind: "other", raw: null };

/**
 * A created file is an edit whose new content is its content.
 *
 * A Write carries `content` and no `new_string`, and every renderer of a diff
 * keys on `newString` -- `resolveEditDiffs` drops any entry without one. Left
 * as it arrives, the proposed content of a new file is data the transcript
 * holds and can never show.
 */
export const asDiffableEdit = (entry: EditEntry): EditEntry =>
	entry.newString !== null && entry.newString !== undefined
		? entry
		: {
				filePath: entry.filePath,
				oldString: entry.oldString,
				newString: entry.content ?? null,
				content: entry.content,
			};

export const toolArgumentsFromCanonical = (
	input: Schema.JsonObject | null | undefined,
	kind: string | null | undefined
): ToolArguments => {
	if (input === null || input === undefined) {
		return noToolArguments;
	}
	const raw = input as unknown as JsonValue;
	if (kind === "execute") {
		// transcript-viewport-row-mapper reads a shell row's command off
		// execute-shaped arguments (commandSummaryFromOperation), so raw
		// arguments leave the row with an empty command block under its output.
		const command = input.command;
		return typeof command === "string" && command.length > 0
			? { kind: "execute", command }
			: { kind: "other", raw };
	}
	if (kind !== "edit") {
		return { kind: "other", raw };
	}
	const entry = normalizeEditEntry(input);
	return entry === null ? { kind: "other", raw } : { kind: "edit", edits: [asDiffableEdit(entry)] };
};
