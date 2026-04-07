import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sessionItemPath = resolve(__dirname, "./session-item.svelte");
const source = readFileSync(sessionItemPath, "utf8");

describe("session item sequence badge", () => {
	it("renders the session sequence badge at 12px for better legibility", () => {
		expect(source).toMatch(
			/<ProjectLetterBadge[\s\S]*color=\{session\.projectColor\}[\s\S]*size=\{12\}[\s\S]*sequenceId=\{session\.sequenceId\}[\s\S]*showLetter=\{false\}/
		);
	});
});
