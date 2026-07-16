import type { ToolCall } from "../../../../types/tool-call.js";
import { bashHighlighter } from "../../../../utils/bash-highlighter.svelte.js";

export function getReadSourceExcerpt(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind !== "read") {
		return null;
	}

	return toolCall.arguments.source_context?.excerpt ?? null;
}

export function getReadSourceHighlighter(
	toolCall: ToolCall
): ((code: string, filePath: string | null | undefined) => string | null) | null {
	const excerpt = getReadSourceExcerpt(toolCall);
	if (!excerpt) {
		return null;
	}

	return bashHighlighter.highlightSource;
}

/** Browser execute-js scripts are JS/TS — reuse source highlighting with a synthetic .ts path. */
export function getBrowserScriptHighlighter(): (code: string) => string | null {
	return (code: string) => bashHighlighter.highlightSource(code, "browser-script.ts");
}

export function getReadSourceRangeLabel(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind !== "read") {
		return null;
	}

	const range = toolCall.arguments.source_context?.viewRange;
	if (!range) {
		return null;
	}

	const start = range.startLine;
	const end = range.endLine;
	if (start === null || start === undefined) {
		return end === null || end === undefined ? null : `Lines ${end}`;
	}

	if (end === null || end === undefined || end === start) {
		return `Line ${start}`;
	}

	return `Lines ${start}-${end}`;
}
