import { describe, expect, it } from "vitest";

import { toolKindFromProviderName, toolKindFromTitle } from "./tool-kind-from-name.js";

describe("toolKindFromProviderName", () => {
	it("classifies every provider tool name AC-280 named as its expected icon kind", () => {
		expect(toolKindFromProviderName("Read")).toBe("read");
		expect(toolKindFromProviderName("View")).toBe("read");
		expect(toolKindFromProviderName("NotebookRead")).toBe("read");
		expect(toolKindFromProviderName("Bash")).toBe("execute");
		expect(toolKindFromProviderName("Write")).toBe("write");
		expect(toolKindFromProviderName("Edit")).toBe("edit");
		expect(toolKindFromProviderName("MultiEdit")).toBe("edit");
		expect(toolKindFromProviderName("Grep")).toBe("search");
		expect(toolKindFromProviderName("Glob")).toBe("search");
		expect(toolKindFromProviderName("WebFetch")).toBe("fetch");
		expect(toolKindFromProviderName("WebSearch")).toBe("web_search");
		expect(toolKindFromProviderName("Task")).toBe("task");
		expect(toolKindFromProviderName("Skill")).toBe("skill");
	});

	it("is case- and separator-insensitive, matching how providers vary tool name casing", () => {
		expect(toolKindFromProviderName("bash")).toBe("execute");
		expect(toolKindFromProviderName("BASH")).toBe("execute");
		expect(toolKindFromProviderName("multi_edit")).toBe("edit");
		expect(toolKindFromProviderName("multi-edit")).toBe("edit");
		expect(toolKindFromProviderName("  Write  ")).toBe("write");
	});

	it("falls back to unclassified honestly for names with no confident mapping", () => {
		// TodoWrite has no AgentToolKind icon that fits it -- "unclassified"
		// (the "?" icon) is the truthful answer here, not a guess.
		expect(toolKindFromProviderName("TodoWrite")).toBe("unclassified");
		expect(toolKindFromProviderName("AskUserQuestion")).toBe("unclassified");
		expect(toolKindFromProviderName("mcp__server__DoThing")).toBe("unclassified");
		expect(toolKindFromProviderName("")).toBe("unclassified");
	});
});

describe("toolKindFromTitle", () => {
	it("classifies a server-formatted display title by its leading verb", () => {
		expect(toolKindFromTitle("Read AGENTS.md")).toBe("read");
		expect(toolKindFromTitle("Write /tmp/qa.txt")).toBe("write");
		expect(toolKindFromTitle("Grep TODO")).toBe("search");
		expect(toolKindFromTitle("Task")).toBe("task");
	});

	it("falls back to unclassified for an execute title (the hint alone, no verb)", () => {
		// toolCallTitle returns the bare shell command for "execute" kind,
		// e.g. "npm test" -- there is no verb prefix to read a kind from, so
		// guessing off the first word ("npm") would be a fabricated kind,
		// not a real one.
		expect(toolKindFromTitle("npm test")).toBe("unclassified");
	});
});
