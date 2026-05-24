import { describe, expect, it } from "vitest";
import {
	isSlashSkillCommand,
	resolveSlashCommandSource,
	shouldShowSlashCommandDropdown,
} from "./slash-command-source.js";

describe("resolveSlashCommandSource", () => {
	it("does not fall back to preconnection commands when a connected session has no live commands", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [],
			hasSession: true,
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
			hasSession: false,
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
			hasSession: true,
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

	it("keeps live skills labeled as skills when they match preconnection skills", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [{ name: "ce:plan", description: "Plan work" }],
			hasSession: true,
			hasConnectedSession: true,
			selectedAgentId: "claude-code",
			preconnectionCommands: [{ name: "ce:plan", description: "Plan work" }],
		});

		expect(source).toEqual({
			source: "live",
			commands: [{ name: "ce:plan", description: "Plan work" }],
			tokenType: "skill",
		});
	});

	it("does not fall back to preconnection commands for a real session before live commands arrive", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [],
			hasSession: true,
			hasConnectedSession: false,
			selectedAgentId: "claude-code",
			preconnectionCommands: [{ name: "ce:plan", description: "Plan work" }],
		});

		expect(source).toEqual({
			source: "none",
			commands: [],
			tokenType: "command",
		});
	});
});

describe("isSlashSkillCommand", () => {
	it("treats commands matching the preconnection skill list as skills", () => {
		expect(
			isSlashSkillCommand({
				command: { name: "ce:review", description: "Review changes" },
				preconnectionCommands: [{ name: "ce:review", description: "Review changes" }],
			})
		).toBe(true);
	});

	it("keeps normal provider commands as commands", () => {
		expect(
			isSlashSkillCommand({
				command: { name: "compact", description: "Compact the session" },
				preconnectionCommands: [{ name: "ce:review", description: "Review changes" }],
			})
		).toBe(false);
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

	it("shows the dropdown for live session commands even when agent identity is temporarily unavailable", () => {
		expect(
			shouldShowSlashCommandDropdown({
				isTriggerActive: true,
				source: {
					source: "live",
					commands: [{ name: "ce-debug", description: "Debug carefully" }],
					tokenType: "command",
				},
				capabilitiesAgentId: null,
			})
		).toBe(true);
	});
});
