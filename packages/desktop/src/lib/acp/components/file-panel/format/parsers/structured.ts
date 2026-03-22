import type { StructuredData, StructuredEntry } from "../types.js";

type StructuredCandidate =
	| (string | number | boolean | null)
	| Date
	| StructuredCandidate[]
	| {
			[key: string]: StructuredCandidate;
	  };

export function normalizeStructuredData(value: StructuredCandidate): StructuredData {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}

	if (value instanceof Date) {
		return value.toISOString();
	}

	if (Array.isArray(value)) {
		return value.map((item) => normalizeStructuredData(item));
	}

	const normalizedRecord: Record<string, StructuredData> = {};
	for (const [key, item] of Object.entries(value)) {
		normalizedRecord[key] = normalizeStructuredData(item);
	}
	return normalizedRecord;
}

export function isStructuredContainer(
	value: StructuredData
): value is StructuredData[] | Record<string, StructuredData> {
	return typeof value === "object" && value !== null;
}

export function toStructuredEntries(value: StructuredData): StructuredEntry[] {
	if (!isStructuredContainer(value)) {
		return [];
	}

	if (Array.isArray(value)) {
		return value.map((item, index) => ({ key: String(index), value: item }));
	}

	return Object.entries(value).map(([key, item]) => ({ key, value: item }));
}

export function formatStructuredPrimitive(value: StructuredData): string {
	if (isStructuredContainer(value)) {
		return getStructuredContainerSummary(value);
	}

	if (typeof value === "string") {
		return JSON.stringify(value);
	}

	if (value === null) {
		return "null";
	}

	return String(value);
}

export function getStructuredContainerSummary(value: StructuredData): string {
	if (!isStructuredContainer(value)) {
		return "Value";
	}

	if (Array.isArray(value)) {
		return `Array(${value.length})`;
	}

	const keyCount = Object.keys(value).length;
	return `Object(${keyCount})`;
}

export function toStructuredRecordFromPairs(
	pairs: Array<{ key: string; value: StructuredData }>
): StructuredData {
	const grouped: Record<string, StructuredData> = {};
	for (const pair of pairs) {
		if (!(pair.key in grouped)) {
			grouped[pair.key] = [];
		}

		const existing = grouped[pair.key];
		if (Array.isArray(existing)) {
			existing.push(pair.value);
		}
	}
	return grouped;
}

export function parseLoosePrimitive(rawValue: string): StructuredData {
	const trimmed = rawValue.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}

/**
 * Attempts to parse a string as JSON or TOML inline table. Returns normalized StructuredData
 * if the string parses to an object or array; otherwise returns null. Tries JSON first, then
 * TOML inline (e.g. `{ version = "2", features = [] }`) when JSON fails.
 */
export function tryParseJsonString(str: string): StructuredData | null {
	const trimmed = str.trim();
	if (trimmed.length < 2 || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
		return null;
	}

	// Try JSON first
	try {
		const parsed = JSON.parse(str) as StructuredCandidate;
		if (typeof parsed === "object" && parsed !== null) {
			return normalizeStructuredData(parsed);
		}
	} catch {
		// Fall through to TOML inline
	}

	// Try TOML inline table (e.g. { version = "2", features = [] })
	if (trimmed[0] === "{") {
		return tryParseTomlInlineTable(trimmed);
	}

	// Try TOML inline array (e.g. [ "a", 1 ])
	if (trimmed[0] === "[") {
		return tryParseTomlInlineArray(trimmed);
	}

	return null;
}

function tryParseTomlInlineTable(str: string): StructuredData | null {
	const inner = str.slice(1, -1).trim();
	if (inner.length === 0) {
		return {};
	}

	const pairs = splitTopLevel(inner, ",");
	if (pairs === null) return null;

	const result: Record<string, StructuredData> = {};
	for (const pair of pairs) {
		const eqIdx = pair.indexOf("=");
		if (eqIdx <= 0) return null;

		const key = pair.slice(0, eqIdx).trim();
		const valueRaw = pair.slice(eqIdx + 1).trim();
		if (key.length === 0) return null;

		const value = parseTomlInlineValue(valueRaw);
		if (value === null) return null;
		result[key] = value;
	}
	return result;
}

function tryParseTomlInlineArray(str: string): StructuredData | null {
	const inner = str.slice(1, -1).trim();
	if (inner.length === 0) {
		return [];
	}

	const parts = splitTopLevel(inner, ",");
	if (parts === null) return null;

	const result: StructuredData[] = [];
	for (const part of parts) {
		const value = parseTomlInlineValue(part.trim());
		if (value === null) return null;
		result.push(value);
	}
	return result;
}

function splitTopLevel(input: string, sep: string): string[] | null {
	const parts: string[] = [];
	let current = "";
	let depth = 0;
	let inDouble = false;
	let inSingle = false;
	let i = 0;

	while (i < input.length) {
		const char = input[i];

		if (!inDouble && !inSingle) {
			if (char === "{") depth++;
			else if (char === "}") depth--;
			else if (char === "[") depth++;
			else if (char === "]") depth--;
			else if (char === '"') inDouble = true;
			else if (char === "'") inSingle = true;
			else if (depth === 0 && char === sep[0] && input.slice(i, i + sep.length) === sep) {
				parts.push(current.trim());
				current = "";
				i += sep.length;
				continue;
			}
		} else if (inDouble) {
			if (char === '"' && input[i - 1] !== "\\") inDouble = false;
		} else if (inSingle) {
			if (char === "'") inSingle = false;
		}

		current += char;
		i++;
	}

	if (depth !== 0 || inDouble || inSingle) return null;
	parts.push(current.trim());
	return parts;
}

function parseTomlInlineValue(raw: string): StructuredData | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;

	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return tryParseTomlInlineTable(trimmed);
	}
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return tryParseTomlInlineArray(trimmed);
	}
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"');
	}

	return trimmed;
}
