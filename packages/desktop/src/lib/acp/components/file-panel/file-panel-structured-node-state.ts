import { Colors } from "@acepe/ui/colors";
import {
	formatStructuredPrimitive,
	getStructuredContainerSummary,
	isStructuredContainer,
	toStructuredEntries,
	tryParseJsonString,
} from "./format/parsers/structured.js";
import type { StructuredData, StructuredEntry } from "./format/types.js";

export interface StructuredNodeDisplayState {
	displayValue: StructuredData;
	isContainer: boolean;
	isArray: boolean;
	isExpandable: boolean;
	containerSummary: string;
	entries: StructuredEntry[];
	keyPrefix: string;
	leftPadding: string;
	primitiveStyle: string;
}

export function buildStructuredNodeDisplayState(input: {
	value: StructuredData;
	label: string | null;
	depth: number;
}): StructuredNodeDisplayState {
	const displayValue = getStructuredNodeDisplayValue(input.value);
	const isContainer = isStructuredContainer(displayValue);
	const entries = isContainer ? toStructuredEntries(displayValue) : [];

	return {
		displayValue,
		isContainer,
		isArray: isContainer && Array.isArray(displayValue),
		isExpandable: isContainer && entries.length > 0,
		containerSummary: isContainer
			? getStructuredContainerSummary(displayValue)
			: formatStructuredPrimitive(displayValue),
		entries,
		keyPrefix: getStructuredNodeKeyPrefix(input.label),
		leftPadding: `${input.depth * 12}px`,
		primitiveStyle: getStructuredPrimitiveStyle(displayValue),
	};
}

export function getStructuredNodeDisplayValue(value: StructuredData): StructuredData {
	if (typeof value !== "string") {
		return value;
	}

	return tryParseJsonString(value) ?? value;
}

export function getStructuredNodeKeyPrefix(label: string | null): string {
	if (label === null) {
		return "root";
	}

	if (/^\d+$/.test(label)) {
		return `[${label}]`;
	}

	return label;
}

export function getStructuredPrimitiveStyle(value: StructuredData): string {
	if (isStructuredContainer(value)) {
		return "";
	}

	if (value === null) {
		return `color: ${Colors.orange}`;
	}

	if (typeof value === "boolean") {
		return `color: ${Colors.purple}`;
	}

	if (typeof value === "number") {
		return `color: ${Colors.cyan}`;
	}

	if (typeof value === "string") {
		return "color: var(--success)";
	}

	return "";
}
