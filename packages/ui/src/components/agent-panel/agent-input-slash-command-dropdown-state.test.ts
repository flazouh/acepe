import { describe, expect, test } from "bun:test";
import {
	getEffectiveSlashCommandIndex,
	getFilteredSlashCommands,
	getNextSlashCommandIndex,
	getSlashCommandEmptyState,
	MAX_SLASH_COMMAND_RESULTS,
	type AgentInputSlashCommand,
} from "./agent-input-slash-command-dropdown-state.js";

function makeCommands(names: readonly string[]): AgentInputSlashCommand[] {
	return names.map((name) => ({
		name,
		description: `${name} command`,
	}));
}

describe("agent input slash command dropdown state", () => {
	test("returns first commands when query is empty", () => {
		const commands = makeCommands(
			Array.from({ length: MAX_SLASH_COMMAND_RESULTS + 2 }, (_, index) => `cmd-${index}`)
		);

		expect(getFilteredSlashCommands(commands, "")).toHaveLength(
			MAX_SLASH_COMMAND_RESULTS
		);
	});

	test("filters commands by case-insensitive name", () => {
		const commands = makeCommands(["Commit", "review", "search"]);

		expect(getFilteredSlashCommands(commands, "COM")).toEqual([commands[0]]);
		expect(getFilteredSlashCommands(commands, "e")).toEqual([
			commands[1],
			commands[2],
		]);
	});

	test("clamps selected index to filtered command count", () => {
		expect(getEffectiveSlashCommandIndex({ selectedIndex: 3, commandCount: 0 })).toBe(
			0
		);
		expect(getEffectiveSlashCommandIndex({ selectedIndex: -2, commandCount: 4 })).toBe(
			0
		);
		expect(getEffectiveSlashCommandIndex({ selectedIndex: 9, commandCount: 4 })).toBe(
			3
		);
	});

	test("wraps keyboard navigation indexes", () => {
		expect(
			getNextSlashCommandIndex({
				currentIndex: 2,
				commandCount: 3,
				direction: "down",
			})
		).toBe(0);
		expect(
			getNextSlashCommandIndex({
				currentIndex: 0,
				commandCount: 3,
				direction: "up",
			})
		).toBe(2);
		expect(
			getNextSlashCommandIndex({
				currentIndex: 0,
				commandCount: 0,
				direction: "down",
			})
		).toBe(0);
	});

	test("selects empty state", () => {
		expect(
			getSlashCommandEmptyState({
				commandCount: 3,
				filteredCount: 1,
				query: "c",
			})
		).toBe("none");
		expect(
			getSlashCommandEmptyState({
				commandCount: 0,
				filteredCount: 0,
				query: "",
			})
		).toBe("no-commands");
		expect(
			getSlashCommandEmptyState({
				commandCount: 3,
				filteredCount: 0,
				query: "missing",
			})
		).toBe("no-results");
		expect(
			getSlashCommandEmptyState({
				commandCount: 3,
				filteredCount: 0,
				query: "",
			})
		).toBe("start-typing");
	});
});
