import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const libDir = import.meta.dir;
const designTokensPath = resolve(libDir, "./design-tokens.css");
const colorsPath = resolve(libDir, "./colors.ts");

describe("color token contract", () => {
	it("keeps the dark build token and Colors.GREEN in sync", () => {
		const designTokensSource = readFileSync(designTokensPath, "utf8");
		const colorsSource = readFileSync(colorsPath, "utf8");

		expect(designTokensSource).toContain("--token-build-icon-dark: #99ffe4;");
		expect(colorsSource).toContain('[COLOR_NAMES.GREEN]: "#99FFE4"');
	});
});
