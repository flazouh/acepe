import { describe, expect, it } from "vitest";

import { ProjectManager, type Project } from "../project-manager.svelte.js";

function createProject(path: string, name: string): Project {
	return {
		path,
		name,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		color: "cyan",
	};
}

describe("ProjectManager", () => {
	it("selects projects by path from the indexed project map", () => {
		const manager = new ProjectManager();
		const firstProject = createProject("/repo/one", "One");
		const secondProject = createProject("/repo/two", "Two");

		manager.projects = [firstProject, secondProject];

		expect(manager.getProject("/repo/one")).toEqual(firstProject);
		expect(manager.getProject("/repo/two")).toEqual(secondProject);
		expect(manager.getProject("/repo/missing")).toBeUndefined();
	});
});
