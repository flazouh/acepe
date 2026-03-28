import { describe, expect, it } from "vitest";
import { resolveSlashCommandSource } from "./slash-command-source.js";

describe("resolveSlashCommandSource", () => {
	it("prefers live commands when they exist", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [{ name: "review", description: "Review code" }],
			hasConnectedSession: true,
			selectedAgentId: "claude-code",
			preconnectionCommands: [{ name: "ce:brainstorm", description: "Brainstorm" }],
		});

		expect(source).toEqual({
			source: "live",
			commands: [{ name: "review", description: "Review code" }],
			tokenType: "command",
		});
	});

	it("ignores stale live commands before connection and uses preconnection skills", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [{ name: "review", description: "Review code" }],
			hasConnectedSession: false,
			selectedAgentId: "claude-code",
			preconnectionCommands: [{ name: "ce:brainstorm", description: "Brainstorm" }],
		});

		expect(source).toEqual({
			source: "preconnection",
			commands: [{ name: "ce:brainstorm", description: "Brainstorm" }],
			tokenType: "skill",
		});
	});

	it("uses preconnection commands when live commands are absent", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [],
			hasConnectedSession: false,
			selectedAgentId: "claude-code",
			preconnectionCommands: [{ name: "ce:brainstorm", description: "Brainstorm" }],
		});

		expect(source).toEqual({
			source: "preconnection",
			commands: [{ name: "ce:brainstorm", description: "Brainstorm" }],
			tokenType: "skill",
		});
	});

	it("returns none when no selected agent or no commands exist", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [],
			hasConnectedSession: false,
			selectedAgentId: null,
			preconnectionCommands: [],
		});

		expect(source).toEqual({
			source: "none",
			commands: [],
			tokenType: "command",
		});
	});

	it("does not fall back to preconnection skills after connection when live commands are empty", () => {
		const source = resolveSlashCommandSource({
			liveCommands: [],
			hasConnectedSession: true,
			selectedAgentId: "claude-code",
			preconnectionCommands: [{ name: "ce:brainstorm", description: "Brainstorm" }],
		});

		expect(source).toEqual({
			source: "none",
			commands: [],
			tokenType: "command",
		});
	});
});
