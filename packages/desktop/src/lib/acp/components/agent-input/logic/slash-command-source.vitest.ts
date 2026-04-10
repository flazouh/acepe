import { describe, expect, it } from "vitest";
import {
	resolveSlashCommandSource,
	shouldShowSlashCommandDropdown,
} from "./slash-command-source.js";

describe("resolveSlashCommandSource", () => {
	it("does not fall back to preconnection commands once a session is connected", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [],
			hasConnectedSession: true,
			selectedAgentId: "copilot",
			preconnectionCommands: [{ name: "ce:review", description: "Review changes" }],
		});

		expect(source).toEqual({
			source: "none",
			commands: [],
			tokenType: "command",
		});
	});

	it("uses preconnection commands before connection when they exist", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [],
			hasConnectedSession: false,
			selectedAgentId: "claude-code",
			preconnectionCommands: [{ name: "ce:plan", description: "Plan work" }],
		});

		expect(source).toEqual({
			source: "preconnection",
			commands: [{ name: "ce:plan", description: "Plan work" }],
			tokenType: "skill",
		});
	});
});

describe("shouldShowSlashCommandDropdown", () => {
	it("hides the dropdown when no slash source exists", () => {
		expect(
			shouldShowSlashCommandDropdown({
				isTriggerActive: true,
				source: {
					source: "none",
					commands: [],
					tokenType: "command",
				},
				capabilitiesAgentId: "copilot",
			})
		).toBe(false);
	});
});
