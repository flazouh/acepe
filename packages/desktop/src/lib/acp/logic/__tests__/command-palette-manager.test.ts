import { describe, expect, it } from "bun:test";

import type { CommandPaletteCommand } from "../../types/command-palette-command.js";
import type { CommandPaletteState } from "../../types/command-palette-state.js";

import { CommandPaletteManager } from "../command-palette-manager.js";

// Mock icon to avoid loading @tabler/icons-svelte (has ESM resolution issues in Bun test)
const mockIcon = {} as import("svelte").ComponentType;

describe("CommandPaletteManager", () => {
	const manager = new CommandPaletteManager();

	const mockCommands: CommandPaletteCommand[] = [
		{
			id: "create-thread",
			label: "Create new thread",
			icon: mockIcon,
		},
	];

	describe("filterCommands", () => {
		it("should return all commands when query is empty and not filtering by dev", () => {
			const result = manager.filterCommands(mockCommands, "", false);
			expect(result).toHaveLength(1); // Only non-devOnly command
			expect(result[0]?.id).toBe("create-thread");
		});

		it("should return all commands including dev when in dev mode", () => {
			const result = manager.filterCommands(mockCommands, "", true);
			expect(result).toHaveLength(1);
		});

		it("should filter by query", () => {
			const result = manager.filterCommands(mockCommands, "thread", true);
			expect(result).toHaveLength(1);
			expect(result[0]?.id).toBe("create-thread");
		});

		it("should filter by query case-insensitively", () => {
			const result = manager.filterCommands(mockCommands, "THREAD", true);
			expect(result).toHaveLength(1);
			expect(result[0]?.id).toBe("create-thread");
		});

		it("should return empty array when no commands match", () => {
			const result = manager.filterCommands(mockCommands, "nonexistent", true);
			expect(result).toHaveLength(0);
		});
	});

	describe("getNextIndex", () => {
		it("should return next index", () => {
			expect(manager.getNextIndex(0, 3)).toBe(1);
			expect(manager.getNextIndex(1, 3)).toBe(2);
		});

		it("should not exceed max index", () => {
			expect(manager.getNextIndex(2, 3)).toBe(2);
			expect(manager.getNextIndex(5, 3)).toBe(2);
		});

		it("should return 0 when command count is 0", () => {
			expect(manager.getNextIndex(0, 0)).toBe(0);
		});
	});

	describe("getPreviousIndex", () => {
		it("should return previous index", () => {
			expect(manager.getPreviousIndex(2)).toBe(1);
			expect(manager.getPreviousIndex(1)).toBe(0);
		});

		it("should not go below 0", () => {
			expect(manager.getPreviousIndex(0)).toBe(0);
			expect(manager.getPreviousIndex(-1)).toBe(0);
		});
	});

	describe("getCommandByIndex", () => {
		it("should return command at valid index", () => {
			const result = manager.getCommandByIndex(mockCommands, 0);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.id).toBe("create-thread");
			}
		});

		it("should return error for negative index", () => {
			const result = manager.getCommandByIndex(mockCommands, -1);
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.code).toBe("INVALID_STATE");
			}
		});

		it("should return error for index out of bounds", () => {
			const result = manager.getCommandByIndex(mockCommands, 10);
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.code).toBe("INVALID_STATE");
			}
		});

		it("should return error when index is out of bounds for empty array", () => {
			const emptyCommands: CommandPaletteCommand[] = [];
			const result = manager.getCommandByIndex(emptyCommands, 0);
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.code).toBe("INVALID_STATE");
			}
		});
	});

	describe("resetSelection", () => {
		it("should reset selected index to 0", () => {
			const state: CommandPaletteState = {
				open: true,
				selectedIndex: 5,
				commands: mockCommands,
				query: "test",
			};

			const result = manager.resetSelection(state);
			expect(result.selectedIndex).toBe(0);
			expect(result.open).toBe(true);
			expect(result.commands).toEqual(mockCommands);
			expect(result.query).toBe("test");
		});
	});
});
