import { describe, expect, it } from "vitest";

import type { ToolArguments } from "../../../../../../services/converted-session-types.js";

import { resolveExecuteCommand } from "../resolve-execute-command.js";

describe("resolveExecuteCommand", () => {
	const executeArgs = (command: string | null): ToolArguments => ({
		kind: "execute",
		command,
	});

	const otherArgs: ToolArguments = { kind: "other", raw: {} };

	it("returns command from streaming arguments first", () => {
		const result = resolveExecuteCommand(
			executeArgs("streaming-cmd"),
			executeArgs("typed-cmd"),
			"`title-cmd`"
		);
		expect(result).toBe("streaming-cmd");
	});

	it("falls back to typed arguments when streaming has no command", () => {
		const result = resolveExecuteCommand(null, executeArgs("typed-cmd"), "`title-cmd`");
		expect(result).toBe("typed-cmd");
	});

	it("falls back to backtick title when no arguments have command", () => {
		const result = resolveExecuteCommand(null, otherArgs, "`cd /path && cargo test`");
		expect(result).toBe("cd /path && cargo test");
	});

	it("returns null when no source has a command", () => {
		const result = resolveExecuteCommand(null, otherArgs, "plain title");
		expect(result).toBeNull();
	});

	it("returns null when all inputs are null/undefined", () => {
		const result = resolveExecuteCommand(null, otherArgs, null);
		expect(result).toBeNull();
	});

	it("skips streaming args when kind is not execute", () => {
		const readArgs: ToolArguments = { kind: "read", file_path: "/foo" };
		const result = resolveExecuteCommand(readArgs, executeArgs("typed-cmd"), null);
		expect(result).toBe("typed-cmd");
	});

	it("skips streaming args when command is null", () => {
		const result = resolveExecuteCommand(executeArgs(null), executeArgs("typed-cmd"), null);
		expect(result).toBe("typed-cmd");
	});

	it("skips typed args when kind is not execute", () => {
		const result = resolveExecuteCommand(null, otherArgs, "`fallback`");
		expect(result).toBe("fallback");
	});

	it("does not match partial backticks in title", () => {
		const result = resolveExecuteCommand(null, otherArgs, "`unclosed");
		expect(result).toBeNull();
	});

	it("does not match title without backticks", () => {
		const result = resolveExecuteCommand(null, otherArgs, "Running command…");
		expect(result).toBeNull();
	});
});
