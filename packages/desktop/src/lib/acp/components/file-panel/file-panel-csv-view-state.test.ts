import { describe, expect, it } from "bun:test";

import { buildFilePanelCsvViewState, getCsvParserFormatKind } from "./file-panel-csv-view-state.js";

describe("file-panel-csv-view-state", () => {
	it("uses tsv parser only for tsv format", () => {
		expect(getCsvParserFormatKind("tsv")).toBe("tsv");
		expect(getCsvParserFormatKind("csv")).toBe("csv");
		expect(getCsvParserFormatKind("json")).toBe("csv");
	});

	it("builds table state for csv content", () => {
		const state = buildFilePanelCsvViewState({
			content: "name,count\nalpha,1\nbeta,2",
			formatKind: "csv",
		});

		expect(state).toEqual({
			type: "table",
			data: {
				headers: ["name", "count"],
				rows: [
					["alpha", "1"],
					["beta", "2"],
				],
			},
		});
	});

	it("builds table state for tsv content", () => {
		const state = buildFilePanelCsvViewState({
			content: "name\tcount\nalpha\t1",
			formatKind: "tsv",
		});

		expect(state).toEqual({
			type: "table",
			data: {
				headers: ["name", "count"],
				rows: [["alpha", "1"]],
			},
		});
	});

	it("builds empty state when no headers exist", () => {
		expect(buildFilePanelCsvViewState({ content: "", formatKind: "csv" })).toEqual({
			type: "empty",
		});
	});

	it("builds error state for invalid csv", () => {
		const state = buildFilePanelCsvViewState({
			content: 'name\n"unterminated',
			formatKind: "csv",
		});

		expect(state.type).toBe("error");
		if (state.type === "error") {
			expect(state.message).toContain("Invalid CSV");
		}
	});
});
