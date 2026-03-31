import { describe, expect, it } from "bun:test";

import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";
import { buildPrPromptPreview, DEFAULT_SHIP_INSTRUCTIONS } from "./build-pr-prompt-preview.js";

const modifiedFiles: readonly ModifiedFileEntry[] = [
	{
		filePath: "/repo/src/alpha.ts",
		fileName: "alpha.ts",
		totalAdded: 2,
		totalRemoved: 1,
		originalContent: "const alpha = 1;\n",
		finalContent: "const alpha = 2;\nconst beta = 3;\n",
		editCount: 1,
	},
	{
		filePath: "/repo/src/new-file.ts",
		fileName: "new-file.ts",
		totalAdded: 2,
		totalRemoved: 0,
		originalContent: null,
		finalContent: "export const created = true;\n",
		editCount: 1,
	},
];

describe("buildPrPromptPreview", () => {
	it("builds a full prompt with branch, summary, and unified diff", () => {
		const prompt = buildPrPromptPreview({
			branch: "feature/prompt-preview",
			projectPath: "/repo",
			modifiedFiles,
		});

		expect(prompt.startsWith(DEFAULT_SHIP_INSTRUCTIONS)).toBe(true);
		expect(prompt).toContain("Respond in this EXACT XML format");
		expect(prompt).toContain("## Abstract");
		expect(prompt).toContain("## Problem");
		expect(prompt).toContain("## Solution");
		expect(prompt).toContain("Explain the problem in depth before describing the fix.");
		expect(prompt).toContain("Include an ASCII diagram that shows the current behavior, failure mode,");
		expect(prompt).toContain("Include a concrete before/after example");
		expect(prompt).toContain("Current branch: feature/prompt-preview");
		expect(prompt).toContain("Staged files:\nM\tsrc/alpha.ts\nA\tsrc/new-file.ts");
		expect(prompt).toContain("diff --git a/src/alpha.ts b/src/alpha.ts");
		expect(prompt).toContain("--- /dev/null\n+++ b/src/new-file.ts");
		expect(prompt).toContain("+export const created = true;");
	});

	it("replaces the default instructions when custom instructions are provided", () => {
		const prompt = buildPrPromptPreview({
			branch: "feature/custom-prompt",
			projectPath: "/repo",
			modifiedFiles,
			customInstructions: "Custom prompt instructions",
		});

		expect(prompt.startsWith("Custom prompt instructions")).toBe(true);
		expect(prompt.includes(DEFAULT_SHIP_INSTRUCTIONS)).toBe(false);
		expect(prompt).toContain("Respond in this EXACT XML format");
		expect(prompt).toContain("<ship>");
		expect(prompt).toContain("Current branch: feature/custom-prompt");
	});
});