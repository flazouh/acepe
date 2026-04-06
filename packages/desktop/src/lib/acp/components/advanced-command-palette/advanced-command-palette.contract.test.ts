import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const wrapperPath = resolve(import.meta.dir, "./advanced-command-palette.svelte");
const indexPath = resolve(import.meta.dir, "./index.ts");

describe("advanced command palette desktop adapter contract", () => {
	it("composes the shared ui command palette shell instead of local presentational components", () => {
		expect(existsSync(wrapperPath)).toBe(true);
		expect(existsSync(indexPath)).toBe(true);

		if (!existsSync(wrapperPath) || !existsSync(indexPath)) {
			return;
		}

		const wrapperSource = readFileSync(wrapperPath, "utf8");
		const indexSource = readFileSync(indexPath, "utf8");

		expect(wrapperSource).toContain('@acepe/ui/command-palette');
		expect(wrapperSource).toContain("<CommandPaletteShell");
		expect(wrapperSource).not.toContain("./palette-tabs.svelte");
		expect(wrapperSource).not.toContain("./palette-results.svelte");
		expect(indexSource).toContain("CommandPaletteItem as PaletteItem");
		expect(indexSource).toContain("CommandPaletteResults as PaletteResults");
		expect(indexSource).toContain("CommandPaletteTabs as PaletteTabs");
	});
});
