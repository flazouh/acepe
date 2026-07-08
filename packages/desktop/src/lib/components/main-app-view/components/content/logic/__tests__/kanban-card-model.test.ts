import { describe, expect, it, mock } from "bun:test";

import type { PrChecksItem } from "@acepe/ui";

import type { SessionLinkedPr } from "$lib/acp/application/dto/session-linked-pr.js";
import type { SessionEntry } from "$lib/acp/application/dto/session-entry.js";
import { DEFAULT_PANEL_HOT_STATE, type Panel, type PanelHotState } from "$lib/acp/store/types.js";
import type { ThreadBoardItem } from "$lib/acp/store/thread-board/thread-board-item.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";

mock.module("$lib/acp/components/activity-entry/activity-entry-projection.js", () => ({
	isActiveCompactActivityKind: (kind: string) => kind === "streaming" || kind === "thinking",
	projectSessionPreviewActivity: () => ({
		selectedTool: null,
		toolKind: null,
		showTaskSubagentList: false,
		taskSubagentTools: [],
		taskDescription: null,
		taskSubagentSummaries: [],
		latestTaskSubagentTool: null,
		latestTool: null,
	}),
}));

const {
	buildKanbanCard,
	buildKanbanSceneCard,
	buildKanbanSceneMenuActions,
	buildOptimisticKanbanCards,
} = await import("../kanban-card-model.js");

function makeThreadBoardItem(overrides: Partial<ThreadBoardItem> = {}): ThreadBoardItem {
	return {
		panelId: "panel-1",
		sessionId: "session-1",
		agentId: "codex",
		autonomousEnabled: false,
		projectPath: "/repo",
		projectName: "acepe",
		projectBadgeLabel: "Ac",
		projectColor: "#9858FF",
		projectIconSrc: null,
		title: "Build file badge",
		lastActivityAt: 100,
		currentModeId: "build",
		currentToolKind: null,
		currentStreamingToolCall: null,
		lastToolKind: null,
		lastToolCall: null,
		insertions: 3,
		deletions: 1,
		todoProgress: null,
		connectionError: null,
		sessionStatus: "idle",
		state: {
			connection: "connected",
			activity: { kind: "idle" },
			pendingInput: { kind: "none" },
			attention: { hasUnseenCompletion: true },
		},
		workBucket: "idle",
		sequenceId: 45,
		worktreePath: null,
		worktreeDeleted: false,
		linkedPr: null,
		status: "idle",
		...overrides,
	};
}

function makePanel(overrides: Partial<Panel> = {}): Panel {
	return {
		id: "panel-1",
		kind: "agent",
		ownerPanelId: null,
		sessionId: null,
		width: 520,
		pendingProjectSelection: false,
		selectedAgentId: "codex",
		projectPath: "/repo",
		agentId: null,
		sessionTitle: null,
		...overrides,
	};
}

function makeProject(overrides: Partial<Project> = {}): Project {
	return {
		id: "project-1",
		path: "/repo",
		name: "acepe",
		color: "#9858FF",
		iconPath: "/repo/icon.png",
		...overrides,
	} as Project;
}

function projectLookup(projects: readonly Project[]) {
	const projectsByPath = new Map(projects.map((project) => [project.path, project]));
	return (projectPath: string) => projectsByPath.get(projectPath);
}

function makeUserEntry(text: string): SessionEntry {
	return {
		id: "entry-1",
		type: "user",
		message: {
			id: "message-1",
			content: { type: "text", text },
			chunks: [{ type: "text", text }],
		},
	};
}

describe("kanban-card-model", () => {
	it("maps a thread board item to a card without leaking unseen state into review cards", () => {
		const card = buildKanbanCard({
			item: makeThreadBoardItem({
				status: "needs_review",
				workBucket: "needs_review",
				autonomousEnabled: true,
				worktreePath: "/repo/.worktrees/feature",
			}),
			getAgentIcon: (agentId) => `/icons/${agentId}.svg`,
			onOpenPrCheckDetails: () => undefined,
		});

		expect(card.id).toBe("session-1");
		expect(card.agentIconSrc).toBe("/icons/codex.svg");
		expect(card.isAutoMode).toBe(true);
		expect(card.projectBadgeLabel).toBe("Ac");
		expect(card.hasUnseenCompletion).toBe(false);
		expect(card.isWorktreeSession).toBe(true);
		expect(card.diffInsertions).toBe(3);
	});

	it("keeps PR footer details and opens check URLs through the injected command", () => {
		const opened: string[] = [];
		const check: PrChecksItem = {
			name: "test",
			status: "COMPLETED",
			conclusion: "SUCCESS",
			detailsUrl: "https://example.test/check",
			startedAt: null,
			completedAt: null,
			workflowName: "CI",
		};
		const linkedPr: SessionLinkedPr = {
			prNumber: 12,
			state: "OPEN",
			url: "https://example.test/pr/12",
			title: "Improve kanban",
			additions: 10,
			deletions: 2,
			isDraft: false,
			isLoading: false,
			hasResolvedDetails: true,
			checksHeadSha: "abc",
			checks: [check],
			isChecksLoading: false,
			hasResolvedChecks: true,
		};

		const card = buildKanbanCard({
			item: makeThreadBoardItem({ linkedPr }),
			getAgentIcon: () => "/agent.svg",
			onOpenPrCheckDetails: (url) => {
				opened.push(url);
			},
		});

		expect(card.prFooter?.prNumber).toBe(12);
		expect(card.hideHeaderDiff).toBe(true);
		card.prFooter?.onOpenCheck?.(check, {} as MouseEvent);
		expect(opened).toEqual(["https://example.test/check"]);
	});

	it("builds optimistic cards only for panels that are starting work", () => {
		const hotStates = new Map<string, PanelHotState>([
			[
				"panel-1",
				{
					...DEFAULT_PANEL_HOT_STATE,
					provisionalAutonomousEnabled: true,
					pendingUserEntry: makeUserEntry("Build the kanban board"),
				},
			],
			[
				"panel-2",
				{
					...DEFAULT_PANEL_HOT_STATE,
				},
			],
			[
				"panel-3",
				{
					...DEFAULT_PANEL_HOT_STATE,
					pendingWorktreeSetup: {
						projectPath: "/repo",
						worktreePath: null,
						phase: "creating-worktree",
					},
				},
			],
		]);

		const cards = buildOptimisticKanbanCards({
			panels: [
				makePanel({ id: "panel-1", worktreePath: "/repo/.worktrees/new" }),
				makePanel({ id: "panel-2" }),
				makePanel({ id: "panel-3" }),
				makePanel({ id: "panel-4", sessionId: "session-4" }),
			],
			getProject: projectLookup([makeProject()]),
			getPanelHotState: (panelId) => hotStates.get(panelId) ?? DEFAULT_PANEL_HOT_STATE,
			getAgentIcon: (agentId) => `/icons/${agentId}.svg`,
		});

		expect(cards.map((card) => card.panelId)).toEqual(["panel-1", "panel-3"]);
		expect(cards[0]?.card.title).toBe("Build the kanban board");
		expect(cards[0]?.card.isAutoMode).toBe(true);
		expect(cards[0]?.card.isWorktreeSession).toBe(true);
		expect(cards[1]?.card.activityText).toBe("Creating worktree...");
	});

	it("keeps the optimistic card while a new session id exists but the board card is not ready", () => {
		const cards = buildOptimisticKanbanCards({
			panels: [makePanel({ sessionId: "session-1" })],
			sessionIdsWithThreadBoardSource: new Set<string>(),
			getProject: projectLookup([makeProject()]),
			getPanelHotState: () => ({
				...DEFAULT_PANEL_HOT_STATE,
				pendingUserEntry: makeUserEntry("Ship the first message"),
			}),
			getAgentIcon: (agentId) => `/icons/${agentId}.svg`,
		});

		expect(cards).toHaveLength(1);
		expect(cards[0]?.card.id).toBe("session-1");
		expect(cards[0]?.card.title).toBe("Ship the first message");
	});

	it("does not duplicate the optimistic card once the real board card exists", () => {
		const cards = buildOptimisticKanbanCards({
			panels: [makePanel({ sessionId: "session-1" })],
			sessionIdsWithThreadBoardSource: new Set(["session-1"]),
			getProject: projectLookup([makeProject()]),
			getPanelHotState: () => ({
				...DEFAULT_PANEL_HOT_STATE,
				pendingUserEntry: makeUserEntry("Ship the first message"),
			}),
			getAgentIcon: (agentId) => `/icons/${agentId}.svg`,
		});

		expect(cards).toEqual([]);
	});

	it("keeps menu and scene-card rules in one tested place", () => {
		expect(buildKanbanSceneMenuActions(false).map((action) => action.id)).toEqual([
			"copy-id",
			"copy-title",
			"open-raw",
			"open-in-acepe",
			"export-markdown",
			"export-json",
		]);
		expect(buildKanbanSceneMenuActions(true).map((action) => action.id)).toContain(
			"copy-streaming-log-path"
		);

		const sceneCard = buildKanbanSceneCard({
			card: buildKanbanCard({
				item: makeThreadBoardItem(),
				getAgentIcon: () => "/agent.svg",
				onOpenPrCheckDetails: () => undefined,
			}),
			footer: {
				kind: "permission",
				label: "Run command",
				command: "bun test",
				filePath: null,
				toolKind: "execute",
				progress: null,
				approveLabel: "Allow",
				rejectLabel: "Deny",
			},
			menuActions: [],
			showCloseAction: true,
		});

		expect(sceneCard.showCloseAction).toBe(true);
		expect(sceneCard.hideBody).toBe(true);
		expect(sceneCard.flushFooter).toBe(false);
	});
});
