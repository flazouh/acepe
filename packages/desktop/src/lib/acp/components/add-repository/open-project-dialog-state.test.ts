import { describe, expect, it } from "bun:test";
import type { ProjectWithSessions } from "./open-project-dialog-props.js";
import {
	extractProjectDisplayNameFromPath,
	filterProjectsBySearchQuery,
	getImportFooterProjectLabel,
	isCloneFormValid,
} from "./open-project-dialog-state.js";

function makeProject(path: string, name: string): ProjectWithSessions {
	return {
		path,
		name,
		agentCounts: new Map(),
		totalSessions: 0,
	};
}

describe("open project dialog state", () => {
	it("returns all projects for an empty search query", () => {
		const projects = [makeProject("/repo/alpha", "Alpha")];

		expect(filterProjectsBySearchQuery(projects, "   ")).toBe(projects);
	});

	it("filters projects by name or path without matching case", () => {
		const projects = [
			makeProject("/repo/alpha", "Alpha"),
			makeProject("/work/beta-api", "Beta API"),
			makeProject("/other/gamma", "Gamma"),
		];

		expect(filterProjectsBySearchQuery(projects, "api")).toEqual([projects[1]]);
		expect(filterProjectsBySearchQuery(projects, "WORK")).toEqual([projects[1]]);
	});

	it("validates clone form fields after trimming whitespace", () => {
		expect(isCloneFormValid("https://github.com/acme/repo.git", "/tmp/repo")).toBe(true);
		expect(isCloneFormValid("  ", "/tmp/repo")).toBe(false);
		expect(isCloneFormValid("https://github.com/acme/repo.git", "  ")).toBe(false);
	});

	it("formats project names from paths", () => {
		expect(extractProjectDisplayNameFromPath("/Users/alex/my_repo")).toBe("My Repo");
		expect(extractProjectDisplayNameFromPath("/Users/alex/my-repo")).toBe("My Repo");
		expect(extractProjectDisplayNameFromPath("plain")).toBe("Plain");
	});

	it("builds footer labels for normal and filtered project lists", () => {
		expect(
			getImportFooterProjectLabel({
				searchQuery: "",
				filteredProjectCount: 2,
				projectCount: 3,
			})
		).toBe("3 projects found");
		expect(
			getImportFooterProjectLabel({
				searchQuery: "api",
				filteredProjectCount: 2,
				projectCount: 3,
			})
		).toBe("2 of 3 projects");
	});
});
