import { describe, expect, it } from "bun:test";

import { ensureProjectHeaderAgentSelected, getProjectHeaderAgents } from "./app-sidebar-agents.js";

describe("getProjectHeaderAgents", () => {
	it("returns only selected agents", () => {
		const result = getProjectHeaderAgents(
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
					availability_kind: { kind: "installable", installed: true },
				},
				{
					id: "codex",
					name: "Codex",
					icon: "codex",
					availability_kind: { kind: "installable", installed: true },
				},
			],
			["claude-code", "cursor"]
		);

		expect(result.map((agent) => agent.id)).toEqual(["claude-code", "cursor"]);
	});

	it("excludes installable-but-not-installed agents that are not selected", () => {
		const result = getProjectHeaderAgents(
			[
				{
					id: "claude-code",
					name: "Claude Code",
					icon: "claude-code",
					availability_kind: { kind: "installable", installed: false },
				},
				{
					id: "opencode",
					name: "OpenCode",
					icon: "opencode",
					availability_kind: { kind: "installable", installed: true },
				},
			],
			["opencode"]
		);

		expect(result.map((agent) => agent.id)).toEqual(["opencode"]);
	});

	it("returns empty list when no agents are selected", () => {
		const result = getProjectHeaderAgents(
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

		expect(result.map((agent) => agent.id)).toEqual([]);
	});
});

describe("ensureProjectHeaderAgentSelected", () => {
	it("appends the spawned agent when it is not already selected", () => {
		expect(ensureProjectHeaderAgentSelected(["claude-code"], "cursor")).toEqual([
			"claude-code",
			"cursor",
		]);
	});

	it("keeps the selection unchanged when the agent is already selected", () => {
		expect(ensureProjectHeaderAgentSelected(["claude-code", "cursor"], "cursor")).toEqual([
			"claude-code",
			"cursor",
		]);
	});
});
