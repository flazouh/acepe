import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";

import { ProjectManager } from "./project-manager.svelte.js";

describe("ProjectManager", () => {
	it("defaults optimistic projects to showing external CLI sessions", () => {
		const projectManager = new ProjectManager();

		projectManager.addProjectOptimistic("/tmp/project", "Project");

		expect(projectManager.projects[0]?.showExternalCliSessions).toBe(true);
	});

	it("rescans sessions after updating external CLI visibility", async () => {
		const projectManager = new ProjectManager();
		projectManager.projects = [
			{
				path: "/tmp/project",
				name: "Project",
				createdAt: new Date("2024-01-01T00:00:00.000Z"),
				color: "#4AD0FF",
				iconPath: null,
				showExternalCliSessions: true,
			},
		];

		const scanSessions = vi.fn(() => okAsync(undefined));
		projectManager.setSessionStore({
			scanSessions,
		} as unknown as SessionStore);

		const client = {
			updateProjectShowExternalCliSessions: vi.fn(() =>
				okAsync({
					setupScript: "",
					runScript: "",
					showExternalCliSessions: false,
				})
			),
		};
		(projectManager as unknown as { client: typeof client }).client = client;

		const result = await projectManager.updateProjectShowExternalCliSessions(
			"/tmp/project",
			false
		);

		expect(result.isOk()).toBe(true);
		expect(client.updateProjectShowExternalCliSessions).toHaveBeenCalledWith(
			"/tmp/project",
			false
		);
		expect(scanSessions).toHaveBeenCalledWith(["/tmp/project"]);
		expect(projectManager.projects[0]?.showExternalCliSessions).toBe(false);
	});
});
