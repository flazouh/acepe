import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sessionItemPath = resolve(__dirname, "./session-item.svelte");
const source = readFileSync(sessionItemPath, "utf8");

describe("session item rename action", () => {
	it("wires a rename menu action to a rename dialog callback", () => {
		expect(source).toContain("onRename?: (sessionId: string, title: string)");
		expect(source).toContain("openRenameDialog");
		expect(source).toContain("{m.file_list_rename()}");
		expect(source).toContain('aria-label="Rename session"');
	});
});
