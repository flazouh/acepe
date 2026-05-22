import type { FilePanelFormatKind, TableData } from "./format/types.js";
import { parseTableContent } from "./format/parsers/delimited.js";

export type FilePanelCsvViewState =
	| {
			type: "error";
			message: string;
	  }
	| {
			type: "empty";
	  }
	| {
			type: "table";
			data: TableData;
	  };

export function buildFilePanelCsvViewState(input: {
	content: string;
	formatKind: FilePanelFormatKind;
}): FilePanelCsvViewState {
	const parseResult = parseTableContent(input.content, getCsvParserFormatKind(input.formatKind));

	if (parseResult.isErr()) {
		return {
			type: "error",
			message: parseResult.error.message,
		};
	}

	if (parseResult.value.headers.length === 0) {
		return { type: "empty" };
	}

	return {
		type: "table",
		data: parseResult.value,
	};
}

export function getCsvParserFormatKind(formatKind: FilePanelFormatKind): "csv" | "tsv" {
	return formatKind === "tsv" ? "tsv" : "csv";
}
