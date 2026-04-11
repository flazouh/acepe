import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { globSync } from "node:fs";

const UI_SRC = resolve(__dirname, "../../../");

function getAllSourceFiles(dir: string): string[] {
	const results: string[] = [];
	const { readdirSync, statSync } = require("node:fs");
	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = resolve(dir, entry.name);
		if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "__tests__") {
			results.push(...getAllSourceFiles(fullPath));
		} else if (entry.isFile() && (entry.name.endsWith(".svelte") || entry.name.endsWith(".ts")) && !entry.name.endsWith(".test.ts")) {
			results.push(fullPath);
		}
	}
	return results;
}

const FORBIDDEN_PATTERNS = [
	{ pattern: /@tauri-apps/, label: "@tauri-apps/*" },
	{ pattern: /\$lib\/store/, label: "$lib/store/*" },
	{ pattern: /\$lib\/utils\/tauri-client/, label: "$lib/utils/tauri-client" },
	{ pattern: /from\s+["']svelte-sonner["']/, label: "svelte-sonner" },
	{ pattern: /\$lib\/paraglide/, label: "$lib/paraglide (i18n)" },
	{ pattern: /\$lib\/services/, label: "$lib/services/*" },
];

describe("@acepe/ui architectural boundaries", () => {
	const sourceFiles = getAllSourceFiles(UI_SRC);

	it("has source files to check", () => {
		expect(sourceFiles.length).toBeGreaterThan(50);
	});

	for (const { pattern, label } of FORBIDDEN_PATTERNS) {
		it(`no source file imports ${label}`, () => {
			const violations: string[] = [];
			for (const filePath of sourceFiles) {
				const content = readFileSync(filePath, "utf-8");
				if (pattern.test(content)) {
					violations.push(relative(UI_SRC, filePath));
				}
			}
			expect(violations).toEqual([]);
		});
	}
});
