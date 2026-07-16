import { describe, expect, it } from "bun:test";

import { classifyPushFiles } from "./pre-push-affected-lib.ts";

describe("classifyPushFiles", () => {
	it("classifies website-only pushes without pulling in desktop", () => {
		const affected = classifyPushFiles([
			"packages/website/src/routes/+page.svelte",
			"packages/website/src/lib/theme/theme.ts",
		]);
		expect(affected.website).toBe(true);
		expect(affected.desktopFrontend).toBe(false);
		expect(affected.desktopRust).toBe(false);
		expect(affected.shared).toBe(false);
	});

	it("treats desktop frontend separately from src-tauri", () => {
		const frontend = classifyPushFiles(["packages/desktop/src/lib/foo.ts"]);
		expect(frontend.desktopFrontend).toBe(true);
		expect(frontend.desktopRust).toBe(false);

		const rust = classifyPushFiles(["packages/desktop/src-tauri/src/lib.rs"]);
		expect(rust.desktopFrontend).toBe(false);
		expect(rust.desktopRust).toBe(true);
	});

	it("marks shared when lockfile or package.json changes", () => {
		const affected = classifyPushFiles(["bun.lock", "package.json"]);
		expect(affected.shared).toBe(true);
	});

	it("does not treat lefthook.yml alone as shared", () => {
		const affected = classifyPushFiles(["lefthook.yml", "scripts/git-hooks/pre-push-affected.ts"]);
		expect(affected.shared).toBe(false);
		expect(affected.rootScripts).toBe(true);
	});
});
