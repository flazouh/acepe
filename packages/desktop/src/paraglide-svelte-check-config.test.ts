import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const svelteCheckTsconfigPath = resolve(process.cwd(), "tsconfig.svelte-check.json");

describe("tsconfig.svelte-check Paraglide support", () => {
	it("keeps generated lib paraglide messages in the Svelte typecheck program", () => {
		const source = readFileSync(svelteCheckTsconfigPath, "utf8");

		expect(source).not.toContain('"src/lib/paraglide/**"');
	});
});