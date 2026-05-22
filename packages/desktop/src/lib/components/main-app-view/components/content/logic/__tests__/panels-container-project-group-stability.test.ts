import { describe, expect, it } from "bun:test";

import {
	createPanelsContainerProjectGroupStabilizer,
	type StablePanelsContainerProjectGroup,
} from "../panels-container-project-group-stability.js";

function panel(id: string) {
	return { id } as never;
}

function group(
	projectPath: string,
	overrides: Partial<StablePanelsContainerProjectGroup> = {}
): StablePanelsContainerProjectGroup {
	return {
		projectPath,
		projectName: projectPath.split("/").pop() ?? "Unknown",
		projectColor: "#4AD0FF",
		projectIconSrc: null,
		agentPanels: [],
		filePanels: [],
		reviewPanels: [],
		terminalPanels: [],
		browserPanels: [],
		gitPanels: [],
		...overrides,
	};
}

describe("panels container project group stability", () => {
	it("reuses a previous group when project metadata and panel identities match", () => {
		const stabilizer = createPanelsContainerProjectGroupStabilizer();
		const first = group("/app", {
			agentPanels: [{ id: "agent-1", sessionProjectPath: "/app", sessionSequenceId: 2 }],
			filePanels: [panel("file-1")],
		});

		const firstResult = stabilizer.stabilize([first]);
		const second = group("/app", {
			agentPanels: [{ id: "agent-1", sessionProjectPath: "/app", sessionSequenceId: 2 }],
			filePanels: [panel("file-1")],
		});
		const secondResult = stabilizer.stabilize([second]);

		expect(firstResult[0]).toBe(first);
		expect(secondResult[0]).toBe(first);
	});

	it("does not reuse when agent project identity or sequence changes", () => {
		const stabilizer = createPanelsContainerProjectGroupStabilizer();
		const first = group("/app", {
			agentPanels: [{ id: "agent-1", sessionProjectPath: "/app", sessionSequenceId: 2 }],
		});
		const second = group("/app", {
			agentPanels: [{ id: "agent-1", sessionProjectPath: "/other", sessionSequenceId: 2 }],
		});
		const third = group("/app", {
			agentPanels: [{ id: "agent-1", sessionProjectPath: "/other", sessionSequenceId: 3 }],
		});

		stabilizer.stabilize([first]);
		expect(stabilizer.stabilize([second])[0]).toBe(second);
		expect(stabilizer.stabilize([third])[0]).toBe(third);
	});

	it("does not reuse when non-agent panel identity changes", () => {
		const stabilizer = createPanelsContainerProjectGroupStabilizer();
		const first = group("/app", { filePanels: [panel("file-1")] });
		const second = group("/app", { filePanels: [panel("file-2")] });

		stabilizer.stabilize([first]);
		expect(stabilizer.stabilize([second])[0]).toBe(second);
	});

	it("drops removed projects from the cache", () => {
		const stabilizer = createPanelsContainerProjectGroupStabilizer();
		const app = group("/app");
		const api = group("/api");

		stabilizer.stabilize([app, api]);
		stabilizer.stabilize([api]);
		const nextApp = group("/app");
		const result = stabilizer.stabilize([nextApp, api]);

		expect(result[0]).toBe(nextApp);
		expect(result[1]).toBe(api);
	});
});
