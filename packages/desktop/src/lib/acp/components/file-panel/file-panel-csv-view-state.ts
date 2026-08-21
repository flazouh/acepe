import * as Result from "effect/Result";
import { parseTableContent } from "./format/parsers/delimited.js";
import type { FilePanelFormatKind, TableData } from "./format/types.js";

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

	if (Result.isFailure(parseResult)) {
		return {
			type: "error",
			message: parseResult.failure.message,
		};
	}

	if (parseResult.success.headers.length === 0) {
		return { type: "empty" };
	}

	return {
		type: "table",
		data: parseResult.success,
	};
}

export function getCsvParserFormatKind(formatKind: FilePanelFormatKind): "csv" | "tsv" {
	return formatKind === "tsv" ? "tsv" : "csv";
}
