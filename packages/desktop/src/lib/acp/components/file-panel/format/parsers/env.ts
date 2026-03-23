import type { StructuredData } from "../types.js";

function sanitizeEnvValue(value: string): string {
	const quoted =
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"));
	const clean = quoted ? value.slice(1, -1) : value;
	if (isSensitiveKeyValue(clean)) {
		return "***";
	}
	return clean;
}

function isSensitiveKeyValue(value: string): boolean {
	const upper = value.toUpperCase();
	return (
		upper.includes("TOKEN") ||
		upper.includes("SECRET") ||
		upper.includes("PASSWORD") ||
		upper.includes("KEY")
	);
}

export function parseEnvLike(content: string): StructuredData {
	const result: Record<string, StructuredData> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}

		const equalIndex = line.indexOf("=");
		if (equalIndex <= 0) {
			continue;
		}

		const key = line.slice(0, equalIndex).trim();
		const value = line.slice(equalIndex + 1).trim();
		result[key] = sanitizeEnvValue(value);
	}

	return result;
}
