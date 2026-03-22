import type { StructuredData } from "../types.js";

import { toStructuredRecordFromPairs } from "./structured.js";

export function parseGitignore(content: string): Array<{ key: string; value: StructuredData }> {
	const entries: Array<{ key: string; value: StructuredData }> = [];
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		if (line.startsWith("#")) {
			entries.push({ key: "comment", value: line.slice(1).trim() });
			continue;
		}
		if (line.startsWith("!")) {
			entries.push({ key: "include", value: line.slice(1) });
			continue;
		}
		entries.push({ key: "ignore", value: line });
	}
	return entries;
}

export function parseContentToStructured(content: string): StructuredData {
	return toStructuredRecordFromPairs(parseGitignore(content));
}
