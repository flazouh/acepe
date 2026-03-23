import { Result } from "neverthrow";

import type { TableData } from "../types.js";

export function parseDelimited(content: string, delimiter: string): TableData {
	const rows: string[][] = [];
	let currentRow: string[] = [];
	let currentCell = "";
	let inQuotes = false;

	for (let i = 0; i < content.length; i++) {
		const char = content[i];

		if (char === '"') {
			if (inQuotes && content[i + 1] === '"') {
				currentCell += '"';
				i++;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}

		if (!inQuotes && char === delimiter) {
			currentRow.push(currentCell);
			currentCell = "";
			continue;
		}

		if (!inQuotes && (char === "\n" || char === "\r")) {
			if (char === "\r" && content[i + 1] === "\n") {
				i++;
			}

			currentRow.push(currentCell);
			rows.push(currentRow);
			currentRow = [];
			currentCell = "";
			continue;
		}

		currentCell += char;
	}

	if (inQuotes) {
		throw new Error("Unclosed quoted value");
	}

	if (currentCell.length > 0 || currentRow.length > 0) {
		currentRow.push(currentCell);
		rows.push(currentRow);
	}

	if (rows.length === 0) {
		return { headers: [], rows: [] };
	}

	const [headers, ...dataRows] = rows;
	const normalizedHeaders = headers.map((header, index) =>
		header.trim().length > 0 ? header : `column_${index + 1}`
	);
	const columnCount = normalizedHeaders.length;
	const normalizedRows = dataRows.map((row) => normalizeRow(row, columnCount));

	return {
		headers: normalizedHeaders,
		rows: normalizedRows,
	};
}

function normalizeRow(row: string[], columnCount: number): string[] {
	if (row.length === columnCount) {
		return row;
	}

	if (row.length > columnCount) {
		return row.slice(0, columnCount);
	}

	return [...row, ...Array.from({ length: columnCount - row.length }, () => "")];
}

export function parseTableContent(
	content: string,
	formatKind: "csv" | "tsv"
): Result<TableData, Error> {
	const delimiter = formatKind === "tsv" ? "\t" : ",";
	return Result.fromThrowable(
		() => parseDelimited(content, delimiter),
		(error) =>
			error instanceof Error
				? new Error(`Invalid ${formatKind.toUpperCase()}: ${error.message}`)
				: new Error("Invalid table file")
	)();
}
