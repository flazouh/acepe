import { describe, expect, it } from "bun:test";
import type { ProjectWithSessions } from "../../add-repository/open-project-dialog-props.js";
import {
	extractNameFromPath,
	filterProjectsBySelectedAgents,
	getCurrentOnboardingStepIndex,
	toggleSelectedOnboardingAgent,
} from "../welcome-screen-state.js";

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

	it("should extract names from unix-style paths", () => {
		expect(extractNameFromPath("/Users/alex/project-one")).toBe("project-one");
		expect(extractNameFromPath("project-two")).toBe("project-two");
		expect(extractNameFromPath("/")).toBe("/");
	});

	it("should map scanning to the projects progress step", () => {
		expect(getCurrentOnboardingStepIndex("splash")).toBe(0);
		expect(getCurrentOnboardingStepIndex("agents")).toBe(1);
		expect(getCurrentOnboardingStepIndex("projects")).toBe(2);
		expect(getCurrentOnboardingStepIndex("scanning")).toBe(2);
	});

	it("should toggle selected agents while keeping at least one selected", () => {
		expect(toggleSelectedOnboardingAgent(["codex"], "claude-code")).toEqual([
			"codex",
			"claude-code",
		]);
		expect(toggleSelectedOnboardingAgent(["codex", "claude-code"], "codex")).toEqual([
			"claude-code",
		]);
		expect(toggleSelectedOnboardingAgent(["codex"], "codex")).toEqual(["codex"]);
	});
});
