import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./agent-panel-layout.svelte"), "utf8");

describe("agent panel layout contract", () => {
	it("routes read tools through the dedicated read component instead of the generic row", () => {
		expect(source).toContain('import AgentToolRead from "./agent-tool-read.svelte"');
		expect(source).toContain('{#if entry.kind === "read"}');
		expect(source).toContain("<AgentToolRead");
		expect(source).toContain("filePath={entry.filePath}");
		expect(source).toContain("status={entry.status}");
	});

	it("passes parsed execute output fields into the execute card", () => {
		expect(source).toContain("<AgentToolExecute");
		expect(source).toContain("stdout={entry.stdout}");
		expect(source).toContain("stderr={entry.stderr}");
		expect(source).toContain("exitCode={entry.exitCode}");
	});
});
