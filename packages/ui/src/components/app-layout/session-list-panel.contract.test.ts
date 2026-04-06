import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const componentPath = resolve(import.meta.dir, "./session-list-panel.svelte");
const indexPath = resolve(import.meta.dir, "./index.ts");

describe("session list panel contract", () => {
	it("exports a presentational grouped session list panel from app-layout", () => {
		expect(existsSync(componentPath)).toBe(true);
		expect(existsSync(indexPath)).toBe(true);
		if (!existsSync(componentPath) || !existsSync(indexPath)) return;

		const source = readFileSync(componentPath, "utf8");
		const indexSource = readFileSync(indexPath, "utf8");

		expect(source).toContain("groups: readonly AppProjectGroup[];");
		expect(source).toContain("query: string;");
		expect(source).toContain("onQueryChange?: (query: string) => void;");
		expect(source).toContain("searchPlaceholder?: string;");
		expect(source).toContain("emptyMessage?: string;");
		expect(source).toContain("<Input");
		expect(source).toContain("placeholder={searchPlaceholder}");
		expect(source).toContain("<AppSidebarProjectGroup");
		expect(source).toContain("{#if totalSessions === 0}");
		expect(source).toContain("{emptyMessage}");
		expect(indexSource).toContain('export { default as SessionListPanel } from "./session-list-panel.svelte";');
	});
});
