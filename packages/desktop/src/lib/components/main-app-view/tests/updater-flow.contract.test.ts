import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const mainAppViewPath = resolve(process.cwd(), "src/lib/components/main-app-view.svelte");

describe("updater flow contract", () => {
	it("splits startup and polling update checks into separate flows", () => {
		expect(existsSync(mainAppViewPath)).toBe(true);
		if (!existsSync(mainAppViewPath)) return;

		const source = readFileSync(mainAppViewPath, "utf8");

		expect(source).toContain('type UpdateCheckTrigger = "startup" | "polling";');
		expect(source).toContain('await checkForAppUpdate("startup");');
		expect(source).toContain('void checkForAppUpdate("polling");');
		expect(source).toContain("let blockAppForUpdate = $state(false);");
		expect(source).toContain("shouldShowBlockingUpdaterOverlay(updaterState)");
	});
});