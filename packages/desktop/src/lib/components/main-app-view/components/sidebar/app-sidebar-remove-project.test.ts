import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	type OrchestrationCommand,
	ProjectId,
	type RpcClient,
	type RpcProjectedProject,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "$lib/rpc/app-client.ts";
import { projects } from "$lib/utils/backend-client/projects.ts";
import {
	type RemoveProjectPanel,
	type RemoveProjectPanels,
	removeProjectFromSidebar,
} from "./app-sidebar-remove-project.ts";

const projected: RpcProjectedProject = {
	projectId: ProjectId.make("project-1"),
	title: "Acepe",
	workspaceRoot: "/repo/acepe",
	createdAt: "2026-08-23T09:00:00.000Z",
	updatedAt: "2026-08-23T10:00:00.000Z",
	deletedAt: null,
	sessionCount: 2,
	color: "indigo",
	showExternalCliSessions: false,
	gitStatus: [],
};

const makeClient = (
	dispatched: OrchestrationCommand[],
	rows: readonly RpcProjectedProject[]
): RpcClient => ({
	dispatch: (command) => {
		dispatched.push(command);
		return Effect.succeed({ sequence: 1 });
	},
	snapshot: () => Effect.succeed({ ...emptyRpcSessionSnapshot(0), projects: rows }),
	getProjectIndex: () =>
		Effect.succeed({
			projectPath: "/repo/acepe",
			files: [],
			showExternalCliSessions: false,
			gitStatus: [],
			totalFiles: 0,
			totalLines: 0,
		}),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
	agentCall: () => Effect.succeed({ op: "agent.list" as const, agents: [] }),
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () =>
		Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
	events: () => Stream.empty,
});

interface PanelSpy {
	readonly panels: RemoveProjectPanels;
	readonly closedSessionPanels: string[];
	readonly closedPanelIds: string[];
	readonly workspacePanelsRemovedFor: string[];
}

const makePanels = (open: {
	terminal?: readonly RemoveProjectPanel[];
	file?: readonly RemoveProjectPanel[];
	browser?: readonly RemoveProjectPanel[];
}): PanelSpy => {
	const closedSessionPanels: string[] = [];
	const closedPanelIds: string[] = [];
	const workspacePanelsRemovedFor: string[] = [];

	return {
		closedSessionPanels,
		closedPanelIds,
		workspacePanelsRemovedFor,
		panels: {
			closePanelBySessionId: (sessionId) => closedSessionPanels.push(sessionId),
			getTerminalPanelsForProject: () => open.terminal ?? [],
			getFilePanelsForProject: () => open.file ?? [],
			getBrowserPanelsForProject: () => open.browser ?? [],
			closeTerminalPanel: (panelId) => closedPanelIds.push(panelId),
			closeFilePanel: (panelId) => closedPanelIds.push(panelId),
			closeBrowserPanel: (panelId) => closedPanelIds.push(panelId),
			removeWorkspacePanelsForProject: (projectPath) => workspacePanelsRemovedFor.push(projectPath),
		},
	};
};

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("removeProjectFromSidebar", () => {
	it("dispatches project.delete for the project behind the menu item", async () => {
		const dispatched: OrchestrationCommand[] = [];
		setAppRpcClientForTest(makeClient(dispatched, [projected]));
		const spy = makePanels({});

		await Effect.runPromise(
			removeProjectFromSidebar({
				projectPath: "/repo/acepe",
				openSessionIds: [],
				panels: spy.panels,
				removeProject: (path) => projects.removeProject(path),
				onFailure: () => {},
			})
		);

		expect(dispatched.map((command) => command.type)).toEqual(["project.delete"]);
		const command = dispatched[0];
		expect(command?.type === "project.delete" ? command.projectId : null).toBe(
			ProjectId.make("project-1")
		);
	});

	it("closes the panels showing the project without touching session rows", async () => {
		const dispatched: OrchestrationCommand[] = [];
		setAppRpcClientForTest(makeClient(dispatched, [projected]));
		const spy = makePanels({
			terminal: [{ id: "terminal-1" }],
			file: [{ id: "file-1" }],
			browser: [{ id: "browser-1" }],
		});

		await Effect.runPromise(
			removeProjectFromSidebar({
				projectPath: "/repo/acepe",
				openSessionIds: ["session-a", "session-b"],
				panels: spy.panels,
				removeProject: (path) => projects.removeProject(path),
				onFailure: () => {},
			})
		);

		expect(spy.closedSessionPanels).toEqual(["session-a", "session-b"]);
		expect(spy.closedPanelIds).toEqual(["terminal-1", "file-1", "browser-1"]);
		expect(spy.workspacePanelsRemovedFor).toEqual(["/repo/acepe"]);
		// The action has no way to delete a session row: it is handed panels and
		// a dispatch, and the projection drops the sessions when the project
		// stops being listed.
	});

	it("reports the failure instead of throwing when the dispatch fails", async () => {
		const dispatched: OrchestrationCommand[] = [];
		// The snapshot lists no project, so the facade cannot resolve a projectId.
		setAppRpcClientForTest(makeClient(dispatched, []));
		const spy = makePanels({});
		const failures: string[] = [];

		await Effect.runPromise(
			removeProjectFromSidebar({
				projectPath: "/repo/acepe",
				openSessionIds: [],
				panels: spy.panels,
				removeProject: (path) => projects.removeProject(path),
				onFailure: (error) => failures.push(error.message),
			})
		);

		expect(dispatched).toEqual([]);
		expect(failures).toHaveLength(1);
	});
});

describe("library projection", () => {
	it("stops listing a project once it is deleted", async () => {
		setAppRpcClientForTest(
			makeClient([], [{ ...projected, deletedAt: "2026-08-23T11:00:00.000Z" }])
		);

		const listed = await Effect.runPromise(projects.getProjects());
		const recent = await Effect.runPromise(projects.getRecentProjects());
		const count = await Effect.runPromise(projects.getProjectCount());

		expect(listed).toEqual([]);
		expect(recent).toEqual([]);
		expect(count).toBe(0);
	});
});
