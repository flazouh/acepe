import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const componentPath = resolve(import.meta.dir, "./agent-icons-row.svelte");
const packageIndexPath = resolve(import.meta.dir, "./index.ts");
const rootIndexPath = resolve(import.meta.dir, "../../index.ts");
const packageJsonPath = resolve(import.meta.dir, "../../../package.json");

const componentSource = readFileSync(componentPath, "utf8");
const packageIndexSource = readFileSync(packageIndexPath, "utf8");
const rootIndexSource = readFileSync(rootIndexPath, "utf8");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
	readonly exports: Record<string, { readonly default: string; readonly svelte: string } | string>;
	readonly scripts?: Record<string, string>;
};

describe("agent icons row contract", () => {
	it("stays package-agnostic and prop driven", () => {
		expect(componentSource).toContain('theme?: AgentIconsRowTheme;');
		expect(componentSource).toContain('size?: number;');
		expect(componentSource).toContain('class?: string;');
		expect(componentSource).toContain(
			'let { theme = "light", size = 20, class: className = "" }: Props = $props();'
		);
		expect(componentSource).toContain('src={agent.iconPath(theme)}');
		expect(componentSource).toContain('class={cn("flex items-center justify-center gap-2", className)}');
		expect(componentSource).not.toContain("websiteThemeStore");
	});

	it("is exported from the shared ui package", () => {
		expect(packageIndexSource).toContain(
			'export { default as AgentIconsRow } from "./agent-icons-row.svelte";'
		);
		expect(packageIndexSource).toContain('export type AgentIconsRowTheme = "light" | "dark";');
		expect(rootIndexSource).toContain(
			'export { AgentIconsRow, type AgentIconsRowTheme } from "./components/agent-icons-row/index.js";'
		);
		expect(packageJson.exports["./agent-icons-row"]).toEqual({
			svelte: "./src/components/agent-icons-row/index.ts",
			default: "./src/components/agent-icons-row/index.ts",
		});
		expect(packageJson.scripts?.check).toBe("svelte-check --tsconfig ./tsconfig.json");
	});
});
