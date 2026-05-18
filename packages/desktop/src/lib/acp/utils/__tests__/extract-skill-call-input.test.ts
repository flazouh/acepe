import { describe, expect, it } from "bun:test";

import type { ToolArguments } from "$lib/services/converted-session-types.js";

import { extractSkillCallInput } from "../extract-skill-call-input.js";

describe("extractSkillCallInput", () => {
	it("does not extract skill name from raw.name", () => {
		const args: ToolArguments = {
			kind: "think",
			skill: null,
			skill_args: null,
			raw: {
				name: "agent-browser",
			},
		};

		const result = extractSkillCallInput(args);
		expect(result.skill).toBeNull();
		expect(result.args).toBeNull();
	});

	it("uses canonical skill fields instead of raw payload", () => {
		const args: ToolArguments = {
			kind: "think",
			skill: "canonical-skill",
			skill_args: "canonical-args",
			raw: {
				name: "raw-skill",
				args: {
					mode: "quick",
					count: 2,
				},
			},
		};

		const result = extractSkillCallInput(args);
		expect(result.skill).toBe("canonical-skill");
		expect(result.args).toBe("canonical-args");
	});

	it("extracts canonical think fields when raw payload is absent", () => {
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
