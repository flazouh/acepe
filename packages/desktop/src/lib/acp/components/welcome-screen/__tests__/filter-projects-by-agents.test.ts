import { describe, expect, it } from "bun:test";

interface ProjectWithSessions {
	path: string;
	name: string;
	agentCounts: Map<string, number | "loading" | "error">;
	totalSessions: number | "loading" | "error";
}

/**
 * Filters projects to show only those with sessions from selected agents.
 * If no agents are selected, shows all projects (inverted logic).
 */
function filterProjectsBySelectedAgents(
	projects: ProjectWithSessions[],
	selectedAgentIds: string[]
): ProjectWithSessions[] {
	// If no agents selected, show all projects
	if (selectedAgentIds.length === 0) {
		return projects;
	}

	const selectedSet = new Set(selectedAgentIds);

	// Filter: keep only projects where at least one selected agent has sessions
	return projects.filter((project) => {
		return Array.from(selectedSet).some((agentId) => {
			const count = project.agentCounts.get(agentId);
			return typeof count === "number" && count > 0;
		});
	});
}

describe("filterProjectsBySelectedAgents", () => {
	const createProject = (
		path: string,
		agentCounts: Record<string, number | "loading" | "error"> = {}
	): ProjectWithSessions => ({
		path,
		name: path.split("/").pop() || path,
		agentCounts: new Map(Object.entries(agentCounts)),
		totalSessions: Object.values(agentCounts).reduce<number>(
			(sum, count) => (typeof count === "number" ? sum + count : sum),
			0
		),
	});

	it("should return all projects when no agents selected", () => {
		const projects = [
			createProject("/project1", { "claude-code": 5 }),
			createProject("/project2", { cursor: 3 }),
		];

		const filtered = filterProjectsBySelectedAgents(projects, []);

		expect(filtered).toEqual(projects);
		expect(filtered.length).toBe(2);
	});

	it("should filter to only projects with selected agent sessions", () => {
		const projects = [
			createProject("/project1", { "claude-code": 5, cursor: 0 }),
			createProject("/project2", { cursor: 3, "claude-code": 0 }),
			createProject("/project3", { "claude-code": 0, cursor: 0 }),
		];

		const filtered = filterProjectsBySelectedAgents(projects, ["claude-code"]);

		expect(filtered.length).toBe(1);
		expect(filtered[0]?.path).toBe("/project1");
	});

	it("should include projects with multiple selected agents", () => {
		const projects = [
			createProject("/project1", { "claude-code": 5, cursor: 0 }),
			createProject("/project2", { cursor: 3, "claude-code": 0 }),
			createProject("/project3", { "claude-code": 2, cursor: 2 }),
		];

		const filtered = filterProjectsBySelectedAgents(projects, ["claude-code", "cursor"]);

		expect(filtered.length).toBe(3);
	});

	it("should exclude projects with zero sessions from selected agents", () => {
		const projects = [
			createProject("/project1", { "claude-code": 5 }),
			createProject("/project2", { "claude-code": 0 }),
			createProject("/project3", { cursor: 3 }),
		];

		const filtered = filterProjectsBySelectedAgents(projects, ["claude-code"]);

		expect(filtered.length).toBe(1);
		expect(filtered[0]?.path).toBe("/project1");
	});

	it("should ignore projects with only loading states", () => {
		const projects = [
			createProject("/project1", { "claude-code": 5 }),
			createProject("/project2", { "claude-code": "loading" }),
			createProject("/project3", { "claude-code": "error" }),
		];

		const filtered = filterProjectsBySelectedAgents(projects, ["claude-code"]);

		expect(filtered.length).toBe(1);
		expect(filtered[0]?.path).toBe("/project1");
	});

	it("should handle agents with no projects", () => {
		const projects = [
			createProject("/project1", { cursor: 5 }),
			createProject("/project2", { cursor: 3 }),
		];

		const filtered = filterProjectsBySelectedAgents(projects, ["claude-code"]);

		expect(filtered.length).toBe(0);
	});

	it("should handle empty project list", () => {
		const filtered = filterProjectsBySelectedAgents([], ["claude-code"]);

		expect(filtered.length).toBe(0);
	});

	it("should return all projects when selected agents have any sessions", () => {
		const projects = [
			createProject("/project1", { "claude-code": 1, cursor: 0 }),
			createProject("/project2", { "claude-code": 0, cursor: 1 }),
		];

		const filtered = filterProjectsBySelectedAgents(projects, ["claude-code", "cursor"]);

		expect(filtered.length).toBe(2);
	});

	it("should handle mixed number and string count values", () => {
		const projects = [
			createProject("/project1", { "claude-code": 5, cursor: "loading" }),
			createProject("/project2", { "claude-code": "error", cursor: 3 }),
			createProject("/project3", { "claude-code": 0, cursor: "loading" }),
		];

		const filtered = filterProjectsBySelectedAgents(projects, ["claude-code", "cursor"]);

		// Should include project1 (claude-code: 5) and project2 (cursor: 3)
		expect(filtered.length).toBe(2);
		expect(filtered.some((p) => p.path === "/project1")).toBe(true);
		expect(filtered.some((p) => p.path === "/project2")).toBe(true);
	});
});
