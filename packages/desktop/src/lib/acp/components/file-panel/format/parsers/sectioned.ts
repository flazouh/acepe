import type { StructuredData } from "../types.js";

import { isStructuredContainer, parseLoosePrimitive } from "./structured.js";

export function parseTomlLike(content: string): StructuredData {
	const sections: Record<string, StructuredData> = {};
	let currentSection = "root";
	sections[currentSection] = {};

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}

		if (line.startsWith("[") && line.endsWith("]")) {
			currentSection = line.slice(1, -1).trim() || "root";
			if (!(currentSection in sections)) {
				sections[currentSection] = {};
			}
			continue;
		}

		const equalIndex = line.indexOf("=");
		if (equalIndex <= 0) {
			continue;
		}

		const key = line.slice(0, equalIndex).trim();
		const valueRaw = line.slice(equalIndex + 1).trim();
		const target = sections[currentSection];
		if (isStructuredContainer(target) && !Array.isArray(target)) {
			target[key] = parseLoosePrimitive(valueRaw);
		}
	}

	return sections;
}

export function parseIniLike(content: string): StructuredData {
	const sections: Record<string, StructuredData> = {};
	let currentSection = "root";
	sections[currentSection] = {};

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) {
			continue;
		}

		if (line.startsWith("[") && line.endsWith("]")) {
			currentSection = line.slice(1, -1).trim() || "root";
			if (!(currentSection in sections)) {
				sections[currentSection] = {};
			}
			continue;
		}

		const separatorIndex = line.includes("=") ? line.indexOf("=") : line.indexOf(":");
		if (separatorIndex <= 0) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		const valueRaw = line.slice(separatorIndex + 1).trim();
		const target = sections[currentSection];
		if (isStructuredContainer(target) && !Array.isArray(target)) {
			target[key] = parseLoosePrimitive(valueRaw);
		}
	}

	return sections;
}
