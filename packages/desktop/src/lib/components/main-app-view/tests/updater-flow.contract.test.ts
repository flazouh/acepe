import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const mainAppViewPath = resolve(process.cwd(), "src/lib/components/main-app-view.svelte");

describe("updater flow contract", () => {
	it("splits startup and polling update checks into separate flows", () => {
		expect(existsSync(mainAppViewPath)).toBe(true);
		if (!existsSync(mainAppViewPath)) return;

		const source = readFileSync(mainAppViewPath, "utf8");

		expect(source).toContain('async function checkForAppUpdate(): Promise<void>');
		expect(source).toContain('await checkForAppUpdate()');
		expect(source).toContain('void checkForAppUpdate()');
		expect(source).toContain("let updaterState =");
		expect(source).toContain("const result = await ResultAsync.fromPromise(check()");
	});
});