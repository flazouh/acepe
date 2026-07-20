import { describe, expect, test } from "bun:test";

import { buildSlashPaletteSections } from "../build-slash-palette-sections.js";

describe("buildSlashPaletteSections", () => {
	test("builds grouped sections for modes, skills, and commands", () => {
		const sections = buildSlashPaletteSections({
			modes: [
				{
					id: "plan",
					name: "Plan",
					description: "Plan mode",
					iconKind: "plan",
				},
			],
			currentModeId: "plan",
			availableModels: [{ id: "opus", name: "Opus", description: "Smart model" }],
			modelsDisplay: null,
			currentModelId: "opus",
			agentId: "claude-code",
			providerMetadata: null,
			commands: [
				{ name: "ce-work", description: "Run CE work" },
				{ name: "my-skill", description: "A skill" },
			],
			preconnectionCommands: [{ name: "my-skill", description: "A skill" }],
			mcpCatalog: null,
		});

		expect(sections.map((section) => section.id)).toEqual([
			"models",
			"modes",
			"skills",
			"commands",
		]);
		expect(sections.find((section) => section.id === "skills")?.items[0]?.kind).toBe("skill");
		expect(sections.find((section) => section.id === "commands")?.items[0]?.kind).toBe("command");
	});
});
