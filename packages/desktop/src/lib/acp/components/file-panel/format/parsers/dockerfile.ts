import type { StructuredData } from "../types.js";

import { toStructuredRecordFromPairs } from "./structured.js";

export function parseLineInstructions(
	content: string
): Array<{ key: string; value: StructuredData }> {
	const instructions: Array<{ key: string; value: StructuredData }> = [];
	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	for (const line of lines) {
		if (line.startsWith("#")) {
			continue;
		}
		const firstSpace = line.indexOf(" ");
		if (firstSpace <= 0) {
			instructions.push({ key: line, value: "" });
			continue;
		}
		instructions.push({
			key: line.slice(0, firstSpace),
			value: line.slice(firstSpace + 1),
		});
	}
	return instructions;
}

export function parseContentToStructured(content: string): StructuredData {
	return toStructuredRecordFromPairs(parseLineInstructions(content));
}
