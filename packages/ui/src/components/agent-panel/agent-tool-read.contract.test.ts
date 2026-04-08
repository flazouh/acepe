import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./agent-tool-read.svelte"), "utf8");

describe("agent tool read contract", () => {
	it("keeps the file badge outside the shimmer wrapper while a read is running", () => {
		expect(source).not.toContain('<TextShimmer class="text-muted-foreground" duration={1.2}>');
		expect(source).toContain("{#if filePath}");
		expect(source).toContain("<FilePathBadge");
	});
});
