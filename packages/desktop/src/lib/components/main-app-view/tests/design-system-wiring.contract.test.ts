import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const testsDir = import.meta.dir;
const componentsDir = resolve(testsDir, "../..");
const topBarPath = resolve(componentsDir, "top-bar/top-bar.svelte");
const mainAppViewPath = resolve(componentsDir, "main-app-view.svelte");

describe("design system wiring contract", () => {
	it("exposes a Design System entry in the dev tools menu", () => {
		expect(existsSync(topBarPath)).toBe(true);
		if (!existsSync(topBarPath)) return;

		const source = readFileSync(topBarPath, "utf8");

		expect(source).toContain('import { Palette } from "phosphor-svelte";');
		expect(source).toContain('{#if import.meta.env.DEV && (onDevShowUpdatePage || onDevShowDesignSystem)}');
		expect(source).toContain('<DropdownMenu.GroupHeading');
		expect(source).toContain("onDevShowDesignSystem?: () => void;");
		expect(source).toContain("span>Design System</span>");
		expect(source).toContain("onclick={onDevShowDesignSystem}");
	});

	it("mounts the design system overlay from the main app shell", () => {
		expect(existsSync(mainAppViewPath)).toBe(true);
		if (!existsSync(mainAppViewPath)) return;

		const source = readFileSync(mainAppViewPath, "utf8");

		expect(source).toContain('import DesignSystemShowcase from "$lib/components/dev/design-system-showcase.svelte";');
		expect(source).toContain("onDevShowDesignSystem={() => {");
		expect(source).toContain("viewState.designSystemOpen = true;");
		expect(source).toContain("<DesignSystemShowcase");
		expect(source).toContain("open={viewState.designSystemOpen}");
	});
});
