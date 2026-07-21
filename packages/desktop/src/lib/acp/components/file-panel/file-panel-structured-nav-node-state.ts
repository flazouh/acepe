import { isStructuredContainer, toStructuredEntries } from "./format/parsers/structured.js";
import type { StructuredData, StructuredEntry } from "./format/types.js";

export interface StructuredNavNodeDisplayState {
	isContainer: boolean;
	isExpandable: boolean;
	isSelected: boolean;
	entries: StructuredEntry[];
	displayLabel: string;
	leftPadding: string;
}

export function buildStructuredNavNodeDisplayState(input: {
	value: StructuredData;
	label: string | null;
	depth: number;
	currentPath: string[];
	selectedPath: string[];
}): StructuredNavNodeDisplayState {
	const isContainer = isStructuredContainer(input.value);
	const entries = isContainer ? toStructuredEntries(input.value) : [];

	return {
		isContainer,
		isExpandable: entries.length > 0,
		isSelected: areStructuredPathsEqual(input.currentPath, input.selectedPath),
		entries,
		displayLabel: getStructuredNavNodeLabel(input.label),
		leftPadding: getStructuredNavNodeLeftPadding(input.depth),
	};
}

export function areStructuredPathsEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

export function getStructuredNavNodeLabel(label: string | null): string {
	if (label === null) {
		return "/";
	}

	if (/^\d+$/.test(label)) {
		return `[${label}]`;
	}

	return label;
}

export function getStructuredNavNodeLeftPadding(depth: number): string {
	return `${depth * 12 + 8}px`;
}
