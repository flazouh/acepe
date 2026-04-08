import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sessionListUiPath = resolve(__dirname, "../session-list-ui.svelte");
const source = readFileSync(sessionListUiPath, "utf8");

describe("session list view mode tooltips", () => {
	it("labels the project view toggle icons for sessions and files", () => {
		expect(source).toContain("m.sidebar_view_sessions()");
		expect(source).toContain("m.sidebar_view_files()");
		expect(source).toContain("<Tooltip.Content>{m.sidebar_view_sessions()}</Tooltip.Content>");
		expect(source).toContain("<Tooltip.Content>{m.sidebar_view_files()}</Tooltip.Content>");
		expect(source).toContain("{#snippet child({ props })}");
		expect(source).not.toContain('class="flex justify-end border-b border-border/50"');
		expect(source).not.toContain('class="pointer-events-none absolute right-0 top-7 z-10 flex"');
		expect(source).toContain("bg-accent text-foreground");
	});
});
