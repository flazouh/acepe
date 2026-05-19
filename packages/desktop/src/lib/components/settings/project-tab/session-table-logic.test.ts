import { describe, expect, it } from "vitest";

import type { SessionSummary } from "$lib/acp/application/dto/session-summary.js";

import { createTableRows, sortRows } from "./session-table-logic.js";
import type { SessionTableRow } from "./session-table-types.js";

function sessionSummary(input: {
	readonly id: string;
	readonly title: string;
	readonly entryCount: number | null;
}): SessionSummary {
	const createdAt = new Date("2026-05-01T00:00:00.000Z");
	const updatedAt = new Date("2026-05-01T00:01:00.000Z");

	return {
		id: input.id,
		projectPath: "/repo",
		agentId: "codex",
		worktreePath: "/repo-worktree",
		title: input.title,
		status: "ready",
		entryCount: input.entryCount,
		isConnected: true,
		isStreaming: false,
		createdAt,
		updatedAt,
		parentId: null,
	};
}

describe("createTableRows", () => {
	it("preserves unknown entry counts instead of rendering them as zero", () => {
		const rows = createTableRows(
			[
				sessionSummary({
					id: "session-1",
					title: "Unknown",
					entryCount: null,
				}),
			],
			new Map(),
			new Map()
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.entryCount).toBeNull();
	});
});

describe("sortRows", () => {
	it("sorts known entry counts while keeping unknown counts last", () => {
		const rows: SessionTableRow[] = [
			{
				id: "unknown",
				title: "Unknown",
				projectPath: "/repo",
				projectName: "repo",
				projectColor: "#6b7280",
				agentId: "codex",
				status: "ready",
				entryCount: null,
				isConnected: true,
				isStreaming: false,
				updatedAt: new Date("2026-05-01T00:00:00.000Z"),
			},
			{
				id: "one",
				title: "One",
				projectPath: "/repo",
				projectName: "repo",
				projectColor: "#6b7280",
				agentId: "codex",
				status: "ready",
				entryCount: 1,
				isConnected: true,
				isStreaming: false,
				updatedAt: new Date("2026-05-01T00:00:00.000Z"),
			},
			{
				id: "two",
				title: "Two",
				projectPath: "/repo",
				projectName: "repo",
				projectColor: "#6b7280",
				agentId: "codex",
				status: "ready",
				entryCount: 2,
				isConnected: true,
				isStreaming: false,
				updatedAt: new Date("2026-05-01T00:00:00.000Z"),
			},
		];

		expect(sortRows(rows, "entryCount", "asc").map((row) => row.id)).toEqual([
			"one",
			"two",
			"unknown",
		]);
		expect(sortRows(rows, "entryCount", "desc").map((row) => row.id)).toEqual([
			"two",
			"one",
			"unknown",
		]);
	});
});
