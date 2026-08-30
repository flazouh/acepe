import { describe, expect, it } from "bun:test";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import { createLoadingSessionGroups } from "../session-list-logic.js";
import {
	getCurrentProjectOrder,
	getMovedProjectOrder,
	isProjectOrderUnchanged,
} from "../session-list-project-order.js";

function project(path: string, createdAt: string, sortOrder?: number): Project {
	return {
		path,
		name: path.slice(path.lastIndexOf("/") + 1),
		createdAt: new Date(createdAt),
		color: "#111111",
		sortOrder,
	};
}

// The rendered order is the projection's order. These tests build the groups the
// way the sidebar does, so a move is always computed against what the user sees.
describe("session list project order", () => {
	it("reads the rendered order straight off the projection ranks", () => {
		const groups = createLoadingSessionGroups([
			project("/repo/a", "2024-01-01T00:00:00.000Z", 2),
			project("/repo/b", "2024-01-02T00:00:00.000Z", 0),
			project("/repo/c", "2024-01-03T00:00:00.000Z", 1),
		]);

		expect(getCurrentProjectOrder(groups)).toEqual(["/repo/b", "/repo/c", "/repo/a"]);
	});

	it("re-renders in the new order when only the projection ranks change", () => {
		const before = createLoadingSessionGroups([
			project("/repo/a", "2024-01-01T00:00:00.000Z", 0),
			project("/repo/b", "2024-01-02T00:00:00.000Z", 1),
		]);
		const after = createLoadingSessionGroups([
			project("/repo/a", "2024-01-01T00:00:00.000Z", 1),
			project("/repo/b", "2024-01-02T00:00:00.000Z", 0),
		]);

		expect(getCurrentProjectOrder(before)).toEqual(["/repo/a", "/repo/b"]);
		expect(getCurrentProjectOrder(after)).toEqual(["/repo/b", "/repo/a"]);
	});

	it("moves a project up by swapping it with the project above it", () => {
		const groups = createLoadingSessionGroups([
			project("/repo/a", "2024-01-01T00:00:00.000Z", 0),
			project("/repo/b", "2024-01-02T00:00:00.000Z", 1),
			project("/repo/c", "2024-01-03T00:00:00.000Z", 2),
		]);

		expect(getMovedProjectOrder(groups, "/repo/c", -1)).toEqual(["/repo/a", "/repo/c", "/repo/b"]);
	});

	it("moves a project down by swapping it with the project below it", () => {
		const groups = createLoadingSessionGroups([
			project("/repo/a", "2024-01-01T00:00:00.000Z", 0),
			project("/repo/b", "2024-01-02T00:00:00.000Z", 1),
		]);

		expect(getMovedProjectOrder(groups, "/repo/a", 1)).toEqual(["/repo/b", "/repo/a"]);
	});

	it("refuses a move off either end of the list", () => {
		const groups = createLoadingSessionGroups([
			project("/repo/a", "2024-01-01T00:00:00.000Z", 0),
			project("/repo/b", "2024-01-02T00:00:00.000Z", 1),
		]);

		expect(getMovedProjectOrder(groups, "/repo/a", -1)).toBeNull();
		expect(getMovedProjectOrder(groups, "/repo/b", 1)).toBeNull();
	});

	it("recognises an order that did not change", () => {
		const groups = createLoadingSessionGroups([
			project("/repo/a", "2024-01-01T00:00:00.000Z", 0),
			project("/repo/b", "2024-01-02T00:00:00.000Z", 1),
		]);

		expect(isProjectOrderUnchanged(groups, ["/repo/a", "/repo/b"])).toBe(true);
		expect(isProjectOrderUnchanged(groups, ["/repo/b", "/repo/a"])).toBe(false);
	});
});
