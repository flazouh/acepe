import { describe, expect, it } from "bun:test";
import { buildSessionRows } from "../session-list-logic.js";
import type { SessionListItem } from "../session-list-types.js";

describe("buildSessionRows", () => {
	it("returns parents with expanded children in order", () => {
		const updatedAt = new Date("2024-01-01T00:00:00Z");
		const items: SessionListItem[] = [
			{
				id: "parent-1",
				title: "Parent",
				projectPath: "/project",
				projectName: "project",
				projectColor: undefined,
				projectIconSrc: null,
				agentId: "opencode",
				createdAt: updatedAt,
				updatedAt,
				isLive: false,
				isOpen: false,
				activity: null,
				parentId: null,
			},
			{
				id: "child-1",
				title: "Child 1",
				projectPath: "/project",
				projectName: "project",
				projectColor: undefined,
				projectIconSrc: null,
				agentId: "opencode",
				createdAt: updatedAt,
				updatedAt,
				isLive: false,
				isOpen: false,
				activity: null,
				parentId: "parent-1",
			},
			{
				id: "child-2",
				title: "Child 2",
				projectPath: "/project",
				projectName: "project",
				projectColor: undefined,
				projectIconSrc: null,
				agentId: "opencode",
				createdAt: updatedAt,
				updatedAt,
				isLive: false,
				isOpen: false,
				activity: null,
				parentId: "parent-1",
			},
			{
				id: "parent-2",
				title: "Parent 2",
				projectPath: "/project",
				projectName: "project",
				projectColor: undefined,
				projectIconSrc: null,
				agentId: "opencode",
				createdAt: updatedAt,
				updatedAt,
				isLive: false,
				isOpen: false,
				activity: null,
				parentId: null,
			},
		];

		const rows = buildSessionRows(items, new Set(["parent-1"]));

		expect(rows.map((row) => row.item.id)).toEqual(["parent-1", "child-1", "child-2", "parent-2"]);
		expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 0]);
	});
});
