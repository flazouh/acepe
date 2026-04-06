import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../permission-bar.svelte"), "utf8");

describe("permission bar contract", () => {
	it("keeps the file chip wrapper clickable", () => {
		expect(source).toContain("const currentPermission = $derived");
		expect(source).toContain("PermissionActionBar permission={currentPermission}");
	});
});
