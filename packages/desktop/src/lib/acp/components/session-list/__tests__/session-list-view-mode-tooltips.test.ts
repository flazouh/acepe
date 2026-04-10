import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sessionListUiPath = resolve(__dirname, "../session-list-ui.svelte");
const source = readFileSync(sessionListUiPath, "utf8");

describe("session list project display mode wiring", () => {
	it("routes project view mode through the project overflow menu instead of inline toggle buttons", () => {
		expect(source).toContain("currentViewMode={viewMode}");
		expect(source).toContain(
			"onViewModeChange={(mode) => setProjectViewMode(group.projectPath, mode)}"
		);
		expect(source).not.toContain("title={m.sidebar_view_sessions()}");
		expect(source).not.toContain("title={m.sidebar_view_files()}");
		expect(source).not.toContain("aria-label={m.sidebar_view_sessions()}");
		expect(source).not.toContain("aria-label={m.sidebar_view_files()}");
		expect(source).not.toContain("<Tooltip.Content>{m.sidebar_view_sessions()}</Tooltip.Content>");
		expect(source).not.toContain("<Tooltip.Content>{m.sidebar_view_files()}</Tooltip.Content>");
		expect(source).not.toContain('<Rows class="h-3 w-3" weight="fill" />');
		expect(source).not.toContain('<TreeView class="h-3 w-3" weight="fill" />');
	});
});
