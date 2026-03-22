import type { SessionEntry } from "$lib/acp/application/dto/session.js";

export function createPendingUserEntry(content: string): SessionEntry {
	const textBlock = { type: "text" as const, text: content };

	return {
		id: crypto.randomUUID(),
		type: "user",
		message: {
			content: textBlock,
			chunks: [textBlock],
			sentAt: new Date(),
		},
		timestamp: new Date(),
	};
}
