import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "bun:test";

const viteConfigSource = readFileSync(resolve(import.meta.dir, "../vite.config.js"), "utf8");

describe("vite dev watcher ignore config", () => {
	it("ignores backend, test-only, and generated files during app dev", () => {
		expect(viteConfigSource).toContain("const ignoredDevWatchPaths = [");
		expect(viteConfigSource).toContain('"**/src-tauri/**"');
		expect(viteConfigSource).toContain('"**/__tests__/**"');
		expect(viteConfigSource).toContain('"**/*.test.{js,ts}"');
		expect(viteConfigSource).toContain('"**/*.spec.{js,ts}"');
		expect(viteConfigSource).toContain('"**/*.vitest.{js,ts}"');
		expect(viteConfigSource).toContain('"**/.svelte-kit/**"');
		expect(viteConfigSource).toContain('"**/src/lib/paraglide/**"');
		expect(viteConfigSource).toContain('"**/build/**"');
		expect(viteConfigSource).toContain('"**/dist/**"');
		expect(viteConfigSource).toContain('"**/coverage/**"');
		expect(viteConfigSource).toContain("ignored: ignoredDevWatchPaths");
	});
});