import { describe, expect, it } from "bun:test";

import type { FilePanel } from "$lib/acp/store/file-panel-type.js";

import {
	buildFilePanelTabsViewState,
	getActiveFilePanel,
	getFilePanelTabFileName,
	getFilePanelTabsWidthStyle,
} from "./file-panel-tabs-state.js";

function makePanel(overrides: Partial<FilePanel> = {}): FilePanel {
	return {
		id: "panel-1",
		kind: "file",
		filePath: "src/app.ts",
		projectPath: "/repo",
		ownerPanelId: null,
		width: 500,
		...overrides,
	};
}

describe("file-panel-tabs-state", () => {
	it("finds the active file panel by id", () => {
		const panelOne = makePanel({ id: "one" });
		const panelTwo = makePanel({ id: "two" });

		expect(getActiveFilePanel([panelOne, panelTwo], "two")).toBe(panelTwo);
	});

	it("falls back to the first file panel when active id is missing", () => {
		const panelOne = makePanel({ id: "one" });

		expect(getActiveFilePanel([panelOne], "missing")).toBe(panelOne);
		expect(getActiveFilePanel([], "missing")).toBeNull();
	});

	it("builds tab view state", () => {
		const state = buildFilePanelTabsViewState({
			filePanels: [
				makePanel({ id: "one", filePath: "src/app.ts", width: 420 }),
				makePanel({ id: "two", filePath: "README.md", width: 520 }),
			],
			activeFilePanelId: "two",
		});

		expect(state.activeFilePanel?.id).toBe("two");
		expect(state.showTabs).toBe(true);
		expect(state.widthStyle).toBe(
			"min-width: 520px; width: 520px; max-width: 520px; flex-basis: 520px;"
		);
		expect(state.tabs).toEqual([
			{
				id: "one",
				filePath: "src/app.ts",
				fileName: "app.ts",
				isSelected: false,
				className: "text-muted-foreground hover:bg-accent/15 hover:text-foreground",
			},
			{
				id: "two",
				filePath: "README.md",
				fileName: "README.md",
				isSelected: true,
				className: "bg-accent/25 text-foreground",
			},
		]);
	});

	it("hides tabs for a single file panel", () => {
		const state = buildFilePanelTabsViewState({
			filePanels: [makePanel()],
			activeFilePanelId: null,
		});

		expect(state.showTabs).toBe(false);
	});

	it("builds filenames and width styles", () => {
		expect(getFilePanelTabFileName("src/nested/file.ts")).toBe("file.ts");
		expect(getFilePanelTabFileName("README.md")).toBe("README.md");
		expect(getFilePanelTabsWidthStyle(300)).toBe(
			"min-width: 300px; width: 300px; max-width: 300px; flex-basis: 300px;"
		);
	});
});
