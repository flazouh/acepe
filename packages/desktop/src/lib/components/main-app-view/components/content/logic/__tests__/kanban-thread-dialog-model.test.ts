import { describe, expect, it } from "bun:test";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { Panel } from "$lib/acp/store/types.js";
import {
	buildKanbanThreadDialogPanelSnapshot,
	resolveKanbanThreadDialogSelectedAgentId,
} from "../kanban-thread-dialog-model.js";

function createPanel(overrides?: Partial<Panel>): Panel {
	return {
		id: "panel-1",
		kind: "agent",
		ownerPanelId: null,
		sessionId: null,
		width: 480,
		pendingProjectSelection: false,
		pendingWorktreeEnabled: null,
		preparedWorktreeLaunch: null,
		selectedAgentId: "claude-code",
		projectPath: "/repo",
		agentId: null,
		sourcePath: null,
		worktreePath: null,
		sessionTitle: null,
		...overrides,
	};
}

function createProject(path = "/repo"): Project {
	return {
		path,
		name: "Repo",
		createdAt: new Date(0),
		color: "#123456",
		iconPath: null,
	};
}

function projectLookup(projects: readonly Project[]) {
	const projectsByPath = new Map(projects.map((project) => [project.path, project]));
	return (projectPath: string) => projectsByPath.get(projectPath);
}

describe("kanban thread dialog model", () => {
	it("returns an empty snapshot when no panel is selected", () => {
		expect(
			buildKanbanThreadDialogPanelSnapshot({
				panel: null,
				sessionIdentity: undefined,
				hotState: null,
				getProject: projectLookup([createProject()]),
			})
		).toEqual({
			panelId: "",
			sessionId: null,
			width: 100,
			pendingProjectSelection: false,
			selectedAgentId: null,
			isWaitingForSession: false,
			project: null,
		});
	});

	it("uses panel project and selected agent before a session exists", () => {
		const snapshot = buildKanbanThreadDialogPanelSnapshot({
			panel: createPanel({ sessionId: null, selectedAgentId: "cursor" }),
			sessionIdentity: undefined,
			hotState: null,
			getProject: projectLookup([createProject()]),
		});

		expect(snapshot.project?.path).toBe("/repo");
		expect(snapshot.selectedAgentId).toBe("cursor");
		expect(snapshot.isWaitingForSession).toBe(false);
	});

	it("uses canonical identity project and agent for existing sessions", () => {
		const snapshot = buildKanbanThreadDialogPanelSnapshot({
			panel: createPanel({ sessionId: "session-1", projectPath: "/panel-repo" }),
			sessionIdentity: {
				id: "session-1",
				projectPath: "/canonical-repo",
				agentId: "codex",
			},
			hotState: null,
			getProject: projectLookup([createProject("/panel-repo"), createProject("/canonical-repo")]),
		});

		expect(snapshot.project?.path).toBe("/canonical-repo");
		expect(snapshot.selectedAgentId).toBe("codex");
		expect(snapshot.isWaitingForSession).toBe(false);
	});

	it("does not fall back to panel project or agent while session identity is missing", () => {
		const snapshot = buildKanbanThreadDialogPanelSnapshot({
			panel: createPanel({
				sessionId: "session-1",
				projectPath: "/panel-repo",
				agentId: "panel-agent",
				selectedAgentId: "selected-agent",
			}),
			sessionIdentity: undefined,
			hotState: null,
			getProject: projectLookup([createProject("/panel-repo")]),
		});

		expect(snapshot.project).toBeNull();
		expect(snapshot.selectedAgentId).toBeNull();
		expect(snapshot.isWaitingForSession).toBe(true);
	});

	it("filters selected agent by available agents", () => {
		expect(
			resolveKanbanThreadDialogSelectedAgentId({
				configuredAgentId: "codex",
				availableAgents: [{ id: "codex" }],
			})
		).toBe("codex");
		expect(
			resolveKanbanThreadDialogSelectedAgentId({
				configuredAgentId: "missing",
				availableAgents: [{ id: "codex" }],
			})
		).toBeNull();
	});
});
