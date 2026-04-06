import { describe, expect, it } from "bun:test";

import {
	ensureSpawnableAgentSelected,
	getSpawnableSessionAgents,
} from "./spawnable-agents.js";

describe("getSpawnableSessionAgents", () => {
	it("includes selected agents and installable agents that are not installed", () => {
		const result = getSpawnableSessionAgents(
			[
				{
					id: "claude-code",
					name: "Claude Code",
					icon: "claude-code",
					availability_kind: { kind: "installable", installed: true },
				},
				{
					id: "cursor",
					name: "Cursor",
					icon: "cursor",
					availability_kind: { kind: "installable", installed: false },
				},
				{
					id: "codex",
					name: "Codex",
					icon: "codex",
					availability_kind: { kind: "installable", installed: true },
				},
			],
			["claude-code"]
		);

		expect(result.map((agent) => agent.id)).toEqual(["claude-code", "cursor"]);
	});

	it("does not add already installed agents that are not selected", () => {
		const result = getSpawnableSessionAgents(
			[
				{
					id: "custom-agent",
					name: "Custom Agent",
					icon: "custom-agent",
					availability_kind: { kind: "installable", installed: true },
				},
				{
					id: "cursor",
					name: "Cursor",
					icon: "cursor",
					availability_kind: { kind: "installable", installed: false },
				},
			],
			[]
		);

		expect(result.map((agent) => agent.id)).toEqual(["cursor"]);
	});

	it("does not auto-include already installed PATH-backed agents that are not selected", () => {
		const result = getSpawnableSessionAgents(
			[
				{
					id: "forge",
					name: "Forge",
					icon: "forge",
					availability_kind: { kind: "installable", installed: true },
				},
				{
					id: "cursor",
					name: "Cursor",
					icon: "cursor",
					availability_kind: { kind: "installable", installed: false },
				},
			],
			[]
		);

		expect(result.map((agent) => agent.id)).toEqual(["cursor"]);
	});
});

describe("ensureSpawnableAgentSelected", () => {
	it("appends the spawned agent when it is not already selected", () => {
		expect(ensureSpawnableAgentSelected(["claude-code"], "cursor")).toEqual([
			"claude-code",
			"cursor",
		]);
	});

	it("keeps the selection unchanged when the agent is already selected", () => {
		expect(ensureSpawnableAgentSelected(["claude-code", "cursor"], "cursor")).toEqual([
			"claude-code",
			"cursor",
		]);
	});
});