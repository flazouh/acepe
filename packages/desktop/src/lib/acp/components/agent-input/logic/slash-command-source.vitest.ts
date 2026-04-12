import { describe, expect, it } from "vitest";
import {
	resolveSlashCommandSource,
	shouldShowSlashCommandDropdown,
} from "./slash-command-source.js";

describe("resolveSlashCommandSource", () => {
	it("falls back to preconnection commands when a connected session has no live commands", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [],
			hasConnectedSession: true,
			selectedAgentId: "copilot",
			preconnectionCommands: [{ name: "ce:review", description: "Review changes" }],
		});

		expect(source).toEqual({
			source: "preconnection",
			commands: [{ name: "ce:review", description: "Review changes" }],
			tokenType: "skill",
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

	it("prefers live commands over preconnection commands once connected", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [{ name: "compact", description: "Compact the session" }],
			hasConnectedSession: true,
			selectedAgentId: "copilot",
			preconnectionCommands: [{ name: "systematic-debugging", description: "Debug carefully" }],
		});

		expect(source).toEqual({
			source: "live",
			commands: [{ name: "compact", description: "Compact the session" }],
			tokenType: "command",
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
