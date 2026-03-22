import { parse as parseYaml } from "yaml";

import type { StructuredData } from "../types.js";

import { normalizeStructuredData } from "./structured.js";

type StructuredCandidate =
	| (string | number | boolean | null)
	| Date
	| StructuredCandidate[]
	| {
			[key: string]: StructuredCandidate;
	  };

export function parseJsonLines(content: string): StructuredData {
	const rows: StructuredData[] = [];
	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	for (const line of lines) {
		const parsed = JSON.parse(line) as StructuredCandidate;
		rows.push(normalizeStructuredData(parsed));
	}

	return rows;
}

export function parseLockfile(content: string): StructuredData {
	const trimmed = content.trim();
	if (trimmed.startsWith("{")) {
		const parsed = JSON.parse(content) as StructuredCandidate;
		return normalizeStructuredData(parsed);
	}

	const parsedYaml = parseYaml(content) as StructuredCandidate;
	return normalizeStructuredData(parsedYaml);
}
