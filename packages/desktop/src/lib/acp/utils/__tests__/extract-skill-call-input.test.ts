import { describe, expect, it } from "bun:test";

import type { ToolArguments } from "$lib/services/converted-session-types.js";

import { extractSkillCallInput } from "../extract-skill-call-input.js";

describe("extractSkillCallInput", () => {
	it("extracts explicit skill name from raw.name", () => {
		const args: ToolArguments = {
			kind: "think",
			skill: null,
			skill_args: null,
			raw: {
				name: "agent-browser",
			},
		};

		const result = extractSkillCallInput(args);
		expect(result.skill).toBe("agent-browser");
		expect(result.args).toBeNull();
	});

	it("prefers raw args and normalizes object args to JSON string", () => {
		const args: ToolArguments = {
			kind: "think",
			skill: "fallback-skill",
			skill_args: "fallback-args",
			raw: {
				name: "agent-browser",
				args: {
					mode: "quick",
					count: 2,
				},
			},
		};

		const result = extractSkillCallInput(args);
		expect(result.skill).toBe("agent-browser");
		expect(result.args).toBe('{"mode":"quick","count":2}');
	});

	it("falls back to legacy think fields when raw payload is absent", () => {
		const args: ToolArguments = {
			kind: "think",
			skill: "legacy-skill",
			skill_args: "legacy-args",
		};

		const result = extractSkillCallInput(args);
		expect(result.skill).toBe("legacy-skill");
		expect(result.args).toBe("legacy-args");
	});

	it("returns nulls for non-think argument kinds", () => {
		const args: ToolArguments = {
			kind: "execute",
			command: "echo ok",
		};

		const result = extractSkillCallInput(args);
		expect(result.skill).toBeNull();
		expect(result.args).toBeNull();
	});
});
