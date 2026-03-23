/**
 * File panel format detection, display options, and parsing.
 *
 * Format-specific logic lives in format/; this module re-exports the public API
 * for backward compatibility. Adding a format = 1 config file + 1 line in registry.
 */

// Types
import type { FilePanelFormatKind } from "./format/types.js";

export type {
	FilePanelDisplayMode,
	FilePanelDisplayOptions,
	FilePanelFormatKind,
	StructuredData,
	StructuredEntry,
	StructuredPrimitive,
	TableData,
} from "./format/types.js";

// Parsers
import { parseTableContent as delimitedParseTableContent } from "./format/parsers/delimited.js";
import {
	formatStructuredPrimitive,
	getStructuredContainerSummary,
	isStructuredContainer,
	toStructuredEntries,
	tryParseJsonString,
} from "./format/parsers/structured.js";
// Registry (format detection, display options, structured parsing)
import {
	getDisplayOptions,
	getFormatKind,
	parseStructuredContent as registryParseStructured,
} from "./format/registry.js";

export function getFilePanelFormatKind(filePath: string) {
	return getFormatKind(filePath);
}

export function getFilePanelDisplayOptions(filePath: string) {
	return getDisplayOptions(filePath);
}

export function parseTableContent(
	content: string,
	formatKind: "csv" | "tsv"
): ReturnType<typeof delimitedParseTableContent> {
	return delimitedParseTableContent(content, formatKind);
}

export function parseCsvContent(content: string): ReturnType<typeof delimitedParseTableContent> {
	return parseTableContent(content, "csv");
}

export function parseStructuredContent(content: string, formatKind: FilePanelFormatKind) {
	return registryParseStructured(content, formatKind);
}

export {
	formatStructuredPrimitive,
	getStructuredContainerSummary,
	isStructuredContainer,
	toStructuredEntries,
	tryParseJsonString,
};
