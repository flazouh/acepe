import { describe, expect, it, vi } from "vitest";
import type {
	FileExplorerPreviewResponse,
	FileExplorerRow,
	FileExplorerSearchResponse,
} from "$lib/services/converted-session-types.js";
import { FileExplorerModalState } from "../file-explorer-modal-state.svelte.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(path: string): FileExplorerRow {
	const parts = path.split("/");
	const dotParts = path.split(".");
	return {
		projectPath: "/project",
		path,
		fileName: parts[parts.length - 1] ? parts[parts.length - 1] : path,
		extension: dotParts[dotParts.length - 1] ? dotParts[dotParts.length - 1] : "",
		pathSegments: path.split("/"),
		gitStatus: null,
		isTracked: true,
		isBinary: false,
		lastModifiedMs: null,
		sizeBytes: null,
		previewKind: "text",
	};
}

function makeSearchResponse(rows: FileExplorerRow[]): FileExplorerSearchResponse {
	return {
		projectPath: "/project",
		query: "",
		total: rows.length,
		rows,
	};
}

type SearchFn = (
	projectPaths: string[],
	query: string,
	limit: number,
	offset: number
) => Promise<FileExplorerSearchResponse>;

type PreviewFn = (
	projectPath: string,
	filePath: string
) => Promise<FileExplorerPreviewResponse>;

function makeState(
	overrides: {
		projectPaths?: string[];
		searchFn?: SearchFn;
		previewFn?: PreviewFn;
	} = {}
) {
	const defaultSearch: SearchFn = async (_p, _q, _l, _o) => makeSearchResponse([]);
	const defaultPreview: PreviewFn = async (_p, _f) =>
		({
			kind: "fallback",
			file_path: "",
			file_name: "",
			reason: "no file",
			size_bytes: null,
			git_status: null,
			preview_kind: "text",
		}) as FileExplorerPreviewResponse;

	return new FileExplorerModalState({
		projectPaths: overrides.projectPaths ? overrides.projectPaths : ["/project"],
		searchFn: overrides.searchFn ? overrides.searchFn : defaultSearch,
		previewFn: overrides.previewFn ? overrides.previewFn : defaultPreview,
	});
}

// ---------------------------------------------------------------------------
// Tests: query and debounced search
// ---------------------------------------------------------------------------

describe("FileExplorerModalState", () => {
	describe("initial state", () => {
		it("starts with empty query", () => {
			const state = makeState();
			expect(state.query).toBe("");
		});

		it("starts with empty rows", () => {
			const state = makeState();
			expect(state.rows).toEqual([]);
		});

		it("starts with selectedIndex of 0", () => {
			const state = makeState();
			expect(state.selectedIndex).toBe(0);
		});

		it("starts with preview null", () => {
			const state = makeState();
			expect(state.preview).toBeNull();
		});

		it("starts not loading", () => {
			const state = makeState();
			expect(state.isLoading).toBe(false);
		});
	});

	describe("setQuery", () => {
		it("updates query immediately", () => {
			const state = makeState();
			state.setQuery("hello");
			expect(state.query).toBe("hello");
		});

		it("resets selectedIndex to 0 when query changes", () => {
			const rows = [makeRow("a.ts"), makeRow("b.ts"), makeRow("c.ts")];
			const state = makeState({
				searchFn: async () => makeSearchResponse(rows),
			});
			state.selectedIndex = 2;
			state.setQuery("new query");
			expect(state.selectedIndex).toBe(0);
		});
	});

	describe("reset", () => {
		it("clears query, rows, selectedIndex, and preview", () => {
			const state = makeState();
			state.setQuery("something");
			state.rows = [makeRow("foo.ts")];
			state.selectedIndex = 1;
			state.reset();
			expect(state.query).toBe("");
			expect(state.rows).toEqual([]);
			expect(state.selectedIndex).toBe(0);
			expect(state.preview).toBeNull();
		});
	});

	describe("keyboard navigation", () => {
		it("navigateDown increments selectedIndex", () => {
			const state = makeState();
			state.rows = [makeRow("a.ts"), makeRow("b.ts"), makeRow("c.ts")];
			state.selectedIndex = 0;
			state.navigateDown();
			expect(state.selectedIndex).toBe(1);
		});

		it("navigateDown wraps around at end", () => {
			const state = makeState();
			state.rows = [makeRow("a.ts"), makeRow("b.ts")];
			state.selectedIndex = 1;
			state.navigateDown();
			expect(state.selectedIndex).toBe(0);
		});

		it("navigateUp decrements selectedIndex", () => {
			const state = makeState();
			state.rows = [makeRow("a.ts"), makeRow("b.ts"), makeRow("c.ts")];
			state.selectedIndex = 2;
			state.navigateUp();
			expect(state.selectedIndex).toBe(1);
		});

		it("navigateUp wraps around at beginning", () => {
			const state = makeState();
			state.rows = [makeRow("a.ts"), makeRow("b.ts")];
			state.selectedIndex = 0;
			state.navigateUp();
			expect(state.selectedIndex).toBe(1);
		});

		it("navigateDown is a no-op when rows is empty", () => {
			const state = makeState();
			state.rows = [];
			state.selectedIndex = 0;
			state.navigateDown();
			expect(state.selectedIndex).toBe(0);
		});

		it("navigateUp is a no-op when rows is empty", () => {
			const state = makeState();
			state.rows = [];
			state.selectedIndex = 0;
			state.navigateUp();
			expect(state.selectedIndex).toBe(0);
		});
	});

	describe("selectedRow", () => {
		it("returns the row at selectedIndex", () => {
			const state = makeState();
			const rows = [makeRow("a.ts"), makeRow("b.ts")];
			state.rows = rows;
			state.selectedIndex = 1;
			expect(state.selectedRow).toEqual(rows[1]);
		});

		it("returns null when rows is empty", () => {
			const state = makeState();
			expect(state.selectedRow).toBeNull();
		});
	});

	describe("searchNow", () => {
		it("calls searchFn with current query and sets rows", async () => {
			const rows = [makeRow("src/index.ts"), makeRow("src/app.ts")];
			const searchFn = vi.fn<SearchFn>(async () => makeSearchResponse(rows));

			const state = makeState({ searchFn });
			state.setQuery("index");
			await state.searchNow();

		expect(searchFn).toHaveBeenCalledWith(["/project"], "index", expect.any(Number), 0);
			expect(state.rows).toEqual(rows);
			expect(state.isLoading).toBe(false);
		});

		it("preserves grouped project ordering returned by search", async () => {
			const rows = [
				{ ...makeRow("b.ts"), projectPath: "/project-a" },
				{ ...makeRow("a.ts"), projectPath: "/project-a" },
				{ ...makeRow("z.ts"), projectPath: "/project-b" },
			];
			const state = makeState({
				projectPaths: ["/project-a", "/project-b"],
				searchFn: async () => makeSearchResponse(rows),
			});

			await state.searchNow();

			expect(state.rows.map((row) => `${row.projectPath}:${row.path}`)).toEqual([
				"/project-a:b.ts",
				"/project-a:a.ts",
				"/project-b:z.ts",
			]);
		});

		it("sets isLoading to true while searching", async () => {
			let resolveSearch!: (r: FileExplorerSearchResponse) => void;
			const searchFn: SearchFn = () =>
				new Promise((resolve) => {
					resolveSearch = resolve;
				});

			const state = makeState({ searchFn });
			const promise = state.searchNow();
			expect(state.isLoading).toBe(true);
			resolveSearch(makeSearchResponse([]));
			await promise;
			expect(state.isLoading).toBe(false);
		});

		it("ignores stale responses (race condition protection)", async () => {
			const rows1 = [makeRow("a.ts")];
			const rows2 = [makeRow("b.ts")];
			let resolveFirst!: (r: FileExplorerSearchResponse) => void;

			const calls: ((r: FileExplorerSearchResponse) => void)[] = [];
			const searchFn: SearchFn = () =>
				new Promise((resolve) => {
					calls.push(resolve);
				});

			const state = makeState({ searchFn });

			// Fire two searches in quick succession
			const p1 = state.searchNow();
			const p2 = state.searchNow();

			// Resolve second one first
			calls[1](makeSearchResponse(rows2));
			await p2;

			// Then resolve the first (stale) one
			calls[0](makeSearchResponse(rows1));
			await p1;

			// Should have rows2, not rows1
			expect(state.rows).toEqual(rows2);
		});

		it("clears preview when a new search starts", async () => {
			const state = makeState({
				searchFn: async () => makeSearchResponse([makeRow("b.ts")]),
			});

			state.preview = {
				kind: "text",
				file_path: "a.ts",
				file_name: "a.ts",
				content: "old",
				language_hint: "ts",
			};

			const promise = state.searchNow();
			expect(state.preview).toBeNull();
			await promise;
		});

		it("loads preview for the first result after search completes", async () => {
			const rows = [makeRow("src/index.ts"), makeRow("src/app.ts")];
			const previewFn = vi.fn<PreviewFn>(async (_projectPath, filePath) => ({
				kind: "text",
				file_path: filePath,
				file_name: filePath,
				content: `preview:${filePath}`,
				language_hint: "ts",
			}));

			const state = makeState({
				searchFn: async () => makeSearchResponse(rows),
				previewFn,
			});

			await state.searchNow();

			expect(previewFn).toHaveBeenCalledWith("/project", "src/index.ts");
			expect(state.preview).toEqual({
				kind: "text",
				file_path: "src/index.ts",
				file_name: "src/index.ts",
				content: "preview:src/index.ts",
				language_hint: "ts",
			});
		});
	});

		describe("loadPreview", () => {
			it("ignores stale preview responses", async () => {
				const previews: ((response: FileExplorerPreviewResponse) => void)[] = [];
			const previewFn: PreviewFn = () =>
				new Promise((resolve) => {
					previews.push(resolve);
				});

				const state = makeState({ previewFn });
				state.rows = [makeRow("a.ts"), makeRow("b.ts")];
				state.selectedIndex = 0;

				const first = state.loadPreview("a.ts");
				state.selectedIndex = 1;
				const second = state.loadPreview("b.ts");

			previews[1]({
				kind: "text",
				file_path: "b.ts",
				file_name: "b.ts",
				content: "b",
				language_hint: "ts",
			});
			await second;

			previews[0]({
				kind: "text",
				file_path: "a.ts",
				file_name: "a.ts",
				content: "a",
				language_hint: "ts",
			});
			await first;

			expect(state.preview).toEqual({
				kind: "text",
				file_path: "b.ts",
				file_name: "b.ts",
				content: "b",
				language_hint: "ts",
			});
		});

		it("loads preview for the new first result when search results change", async () => {
				let currentRows = [makeRow("a.ts")];
				const state = makeState({
					searchFn: async () => makeSearchResponse(currentRows),
				previewFn: async (_projectPath, filePath) => ({
					kind: "text",
					file_path: filePath,
					file_name: filePath,
					content: "preview",
					language_hint: "ts",
				}),
				});
				state.rows = [makeRow("a.ts")];
				state.selectedIndex = 0;

				await state.loadPreview("a.ts");
			expect(state.preview).not.toBeNull();

			currentRows = [makeRow("b.ts")];
			await state.searchNow();

			expect(state.preview).toEqual({
				kind: "text",
				file_path: "b.ts",
				file_name: "b.ts",
				content: "preview",
				language_hint: "ts",
			});
		});

		it("uses the selected row project path when loading preview", async () => {
			const previewFn = vi.fn<PreviewFn>(async (_projectPath, filePath) => ({
				kind: "text",
				file_path: filePath,
				file_name: filePath,
				content: "preview",
				language_hint: "ts",
			}));
			const state = makeState({ previewFn });
			state.rows = [
				{ ...makeRow("a.ts"), projectPath: "/project-a" },
				{ ...makeRow("b.ts"), projectPath: "/project-b" },
			];
			state.selectedIndex = 1;

			await state.loadPreview("b.ts");

			expect(previewFn).toHaveBeenCalledWith("/project-b", "b.ts");
		});
	});
});
