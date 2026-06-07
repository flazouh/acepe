import { describe, expect, it } from "bun:test";

import {
	canShowEmptyStateInput,
	getEmptyStateProjectName,
	getEmptyStateProjectPath,
	isEmptyStateWorktreeEffectivelyPending,
	resolveEmptyStateProject,
	shouldShowEmptyStateProjectChooser,
	shouldShowEmptyStateProjectPicker,
} from "../empty-state-view-state.js";

const projects = [
	{ path: "/repo/a", name: "A" },
	{ path: "/repo/b", name: "B" },
] as const;

describe("empty-state view state", () => {
	it("uses the selected project before falling back to the first project", () => {
		expect(
			resolveEmptyStateProject({
				selectedProject: projects[1],
				projects,
			})
		).toBe(projects[1]);
		expect(
			resolveEmptyStateProject({
				selectedProject: null,
				projects,
			})
		).toBe(projects[0]);
		expect(
			resolveEmptyStateProject({
				selectedProject: null,
				projects: [],
			})
		).toBeNull();
	});

	it("gets project path and name from the effective project", () => {
		expect(getEmptyStateProjectPath(projects[0])).toBe("/repo/a");
		expect(getEmptyStateProjectPath(null)).toBeNull();
		expect(getEmptyStateProjectName(projects[0])).toBe("A");
		expect(getEmptyStateProjectName(null)).toBeNull();
	});

	it("shows the project picker only when there are multiple projects", () => {
		expect(shouldShowEmptyStateProjectPicker(0)).toBe(false);
		expect(shouldShowEmptyStateProjectPicker(1)).toBe(false);
		expect(shouldShowEmptyStateProjectPicker(2)).toBe(true);
	});

	it("shows the project chooser only when no projects exist", () => {
		expect(shouldShowEmptyStateProjectChooser(0)).toBe(true);
		expect(shouldShowEmptyStateProjectChooser(1)).toBe(false);
		expect(shouldShowEmptyStateProjectChooser(2)).toBe(false);
	});

	it("shows input only when a project and agent exist", () => {
		expect(
			canShowEmptyStateInput({
				projectCount: 1,
				availableAgentCount: 1,
			})
		).toBe(true);
		expect(
			canShowEmptyStateInput({
				projectCount: 0,
				availableAgentCount: 1,
			})
		).toBe(false);
		expect(
			canShowEmptyStateInput({
				projectCount: 1,
				availableAgentCount: 0,
			})
		).toBe(false);
	});

	it("treats worktree as pending only before an active path exists", () => {
		expect(
			isEmptyStateWorktreeEffectivelyPending({
				worktreePending: true,
				activeWorktreePath: null,
			})
		).toBe(true);
		expect(
			isEmptyStateWorktreeEffectivelyPending({
				worktreePending: true,
				activeWorktreePath: "/repo/worktree",
			})
		).toBe(false);
		expect(
			isEmptyStateWorktreeEffectivelyPending({
				worktreePending: false,
				activeWorktreePath: null,
			})
		).toBe(false);
	});
});
