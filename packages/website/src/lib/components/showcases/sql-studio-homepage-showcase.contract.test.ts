import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	resolve(
		fileURLToPath(new URL(".", import.meta.url)),
		"./sql-studio-homepage-showcase.svelte",
	),
	"utf8",
);

describe("sql studio homepage showcase contract", () => {
	it("uses real sql studio chrome instead of fake wrapper markup", () => {
		expect(source).toContain("SqlStudioToolbar");
		expect(source).toContain("SqlStudioFilterBar");
		expect(source).toContain("SqlStudioDataGrid");
		expect(source).toContain("SqlStudioStatusBar");
		expect(source).not.toContain('import { HardDrives }');
		expect(source).not.toContain("3 rows");
	});
});
