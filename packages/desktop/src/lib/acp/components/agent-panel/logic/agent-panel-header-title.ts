import type { SessionEntry } from "$lib/acp/application/dto/session.js";

import {
	deriveSessionTitleFromUserInput,
	formatSessionTitleForDisplay,
	isFallbackSessionTitle,
} from "../../../store/session-title-policy.js";

function firstUserMessageText(sessionEntries: readonly SessionEntry[]): string | null {
	for (const entry of sessionEntries) {
		if (entry.type !== "user") {
			continue;
		}

		const textChunks = entry.message.chunks.filter((chunk) => chunk.type === "text");
		if (textChunks.length > 0) {
			return textChunks.map((chunk) => chunk.text).join("\n");
		}

		if (entry.message.content.type === "text") {
			return entry.message.content.text;
		}

		return null;
	}

	return null;
}

function stableTitleSource(
	sessionTitle: string | null,
	sessionEntries: readonly SessionEntry[]
): string | null {
	if (sessionTitle !== null && !isFallbackSessionTitle(sessionTitle)) {
		return sessionTitle;
	}

	const firstUserText = firstUserMessageText(sessionEntries);
	if (firstUserText === null) {
		return sessionTitle;
	}

	return deriveSessionTitleFromUserInput(firstUserText) ?? sessionTitle;
}

export function deriveAgentPanelHeaderDisplayTitle(input: {
	readonly sessionTitle: string | null;
	readonly projectName: string | null;
	readonly sessionEntries: readonly SessionEntry[];
}): string | null {
	const titleSource = stableTitleSource(input.sessionTitle, input.sessionEntries);
	if (titleSource === null && input.projectName === null) {
		return null;
	}

	return formatSessionTitleForDisplay(titleSource, input.projectName, "Project");
}
