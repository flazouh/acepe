import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const kbdDir = import.meta.dir;
const kbdPath = resolve(kbdDir, "./kbd.svelte");
const kbdGroupPath = resolve(kbdDir, "./kbd-group.svelte");
const kbdIndexPath = resolve(kbdDir, "./index.ts");
const rootUiIndexPath = resolve(kbdDir, "../../index.ts");
const uiPackageJsonPath = resolve(kbdDir, "../../../package.json");

describe("kbd UI contract", () => {
	it("adds the shared keyboard badge presentational files", () => {
		expect(existsSync(kbdPath)).toBe(true);
		expect(existsSync(kbdGroupPath)).toBe(true);
		expect(existsSync(kbdIndexPath)).toBe(true);
	});

	it("exports the keyboard badge components from the UI package", () => {
		expect(existsSync(kbdIndexPath)).toBe(true);
		expect(existsSync(rootUiIndexPath)).toBe(true);
		expect(existsSync(uiPackageJsonPath)).toBe(true);
		if (!existsSync(kbdIndexPath) || !existsSync(rootUiIndexPath) || !existsSync(uiPackageJsonPath)) return;

		const kbdIndexSource = readFileSync(kbdIndexPath, "utf8");
		const rootUiIndexSource = readFileSync(rootUiIndexPath, "utf8");
		const uiPackageJsonSource = readFileSync(uiPackageJsonPath, "utf8");

		expect(kbdIndexSource).toContain("KbdGroup");
		expect(kbdIndexSource).toContain("Root as Kbd");
		expect(rootUiIndexSource).toContain('export { Kbd, KbdGroup } from "./components/kbd/index.js";');
		expect(uiPackageJsonSource).toContain('"./kbd"');
		expect(uiPackageJsonSource).toContain('"./src/components/kbd/index.ts"');
	});
});
