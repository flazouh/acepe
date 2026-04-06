import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const componentIndexPath = resolve(import.meta.dir, "./index.ts");
const shellPath = resolve(import.meta.dir, "./command-palette-shell.svelte");
const packageJsonPath = resolve(import.meta.dir, "../../../package.json");
const rootIndexPath = resolve(import.meta.dir, "../../index.ts");

describe("command palette package contract", () => {
	it("exports the reusable command palette entry point", () => {
		expect(existsSync(componentIndexPath)).toBe(true);
		expect(existsSync(packageJsonPath)).toBe(true);
		expect(existsSync(rootIndexPath)).toBe(true);

		if (!existsSync(componentIndexPath) || !existsSync(packageJsonPath) || !existsSync(rootIndexPath)) {
			return;
		}

		const componentIndexSource = readFileSync(componentIndexPath, "utf8");
		const packageJsonSource = readFileSync(packageJsonPath, "utf8");
		const rootIndexSource = readFileSync(rootIndexPath, "utf8");

		expect(componentIndexSource).toContain("CommandPaletteShell");
		expect(componentIndexSource).toContain("CommandPaletteTabs");
		expect(componentIndexSource).toContain("CommandPaletteResults");
		expect(componentIndexSource).toContain("CommandPaletteItem");
		expect(componentIndexSource).toContain("PaletteItem");
		expect(componentIndexSource).toContain("PaletteItemMetadata");
		expect(componentIndexSource).toContain("PaletteMode");
		expect(packageJsonSource).toContain('"./command-palette"');
		expect(rootIndexSource).toContain('./components/command-palette/index.js');
	});

	it("keeps the shared shell prop-driven instead of importing desktop ACP state", () => {
		expect(existsSync(shellPath)).toBe(true);
		if (!existsSync(shellPath)) return;

		const shellSource = readFileSync(shellPath, "utf8");

		expect(shellSource).toContain('from "../dialog/index.js"');
		expect(shellSource).toContain("CommandPaletteTabs");
		expect(shellSource).toContain("CommandPaletteResults");
		expect(shellSource).not.toContain("UseAdvancedCommandPalette");
		expect(shellSource).not.toContain("use-advanced-command-palette");
	});
});
