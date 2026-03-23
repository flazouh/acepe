import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import { finalizePermissionResult } from "../permission-result.js";

describe("finalizePermissionResult", () => {
	it("keeps allow-once results unchanged", () => {
		const result: PermissionResult = {
			behavior: "allow",
			updatedInput: { command: "git status" },
		};

		expect(finalizePermissionResult(result, "Bash", "default")).toEqual(result);
	});

	it("adds a fallback session rule when always-allow returns an empty update list", () => {
		const result: PermissionResult = {
			behavior: "allow",
			updatedInput: { command: "git status" },
			updatedPermissions: [],
		};

		expect(finalizePermissionResult(result, "Bash", "default")).toEqual({
			behavior: "allow",
			updatedInput: { command: "git status" },
			updatedPermissions: [
				{
					type: "addRules",
					rules: [{ toolName: "Bash" }],
					behavior: "allow",
					destination: "session",
				},
			],
		});
	});

	it("adds a fallback mode update when exit-plan approval returns an empty update list", () => {
		const result: PermissionResult = {
			behavior: "allow",
			updatedInput: {},
			updatedPermissions: [],
		};

		expect(finalizePermissionResult(result, "ExitPlanMode", "acceptEdits")).toEqual({
			behavior: "allow",
			updatedInput: {},
			updatedPermissions: [
				{
					type: "setMode",
					mode: "acceptEdits",
					destination: "session",
				},
			],
		});
	});

	it("keeps non-empty permission updates unchanged", () => {
		const result: PermissionResult = {
			behavior: "allow",
			updatedInput: { command: "git status" },
			updatedPermissions: [
				{
					type: "addRules",
					rules: [{ toolName: "Bash" }],
					behavior: "allow",
					destination: "session",
				},
			],
		};

		expect(finalizePermissionResult(result, "Bash", "default")).toEqual(result);
	});
});
