import { describe, expect, it } from "bun:test";

import type { AvailableCommand } from "../../../../types/available-command.js";

import { filterCommands } from "../command-filter.js";

describe("filterCommands", () => {
	const commands: AvailableCommand[] = [
		{ name: "test", description: "Run tests", input: null },
		{ name: "review", description: "Review code", input: null },
		{ name: "plan", description: "Create a plan", input: null },
		{ name: "mcp:github", description: "GitHub MCP command", input: null },
	];

	it("should return all commands when query is empty", () => {
		const result = filterCommands(commands, "");
		expect(result).toEqual(commands);
	});

	it("should return all commands when query is whitespace", () => {
		const result = filterCommands(commands, "   ");
		// Whitespace is treated as empty, so all commands are returned
		expect(result).toEqual(commands);
	});

	it("should filter commands by name (case-insensitive)", () => {
		const result = filterCommands(commands, "test");
		expect(result).toEqual([{ name: "test", description: "Run tests", input: null }]);
	});

	it("should filter commands by name (case-insensitive - uppercase query)", () => {
		const result = filterCommands(commands, "TEST");
		expect(result).toEqual([{ name: "test", description: "Run tests", input: null }]);
	});

	it("should filter commands by name (case-insensitive - mixed case)", () => {
		const result = filterCommands(commands, "TeSt");
		expect(result).toEqual([{ name: "test", description: "Run tests", input: null }]);
	});

	it("should filter commands by partial name match", () => {
		const result = filterCommands(commands, "rev");
		expect(result).toEqual([{ name: "review", description: "Review code", input: null }]);
	});

	it("should filter commands by partial name match (middle)", () => {
		const result = filterCommands(commands, "lan");
		expect(result).toEqual([{ name: "plan", description: "Create a plan", input: null }]);
	});

	it("should return multiple matches when query matches multiple commands", () => {
		const result = filterCommands(commands, "e");
		expect(result.length).toBeGreaterThan(0);
		expect(result.every((cmd) => cmd.name.includes("e"))).toBe(true);
	});

	it("should handle commands with colons in name", () => {
		const result = filterCommands(commands, "mcp");
		expect(result).toEqual([
			{ name: "mcp:github", description: "GitHub MCP command", input: null },
		]);
	});

	it("should return empty array when no matches found", () => {
		const result = filterCommands(commands, "nonexistent");
		expect(result).toEqual([]);
	});

	it("should handle empty commands array", () => {
		const result = filterCommands([], "test");
		expect(result).toEqual([]);
	});

	it("should handle empty commands array with empty query", () => {
		const result = filterCommands([], "");
		expect(result).toEqual([]);
	});
});
