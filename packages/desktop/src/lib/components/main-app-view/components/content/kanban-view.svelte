<script lang="ts">
import {
	Dialog,
	DialogContent,
	type AgentToolKind,
	type KanbanCardData,
	type KanbanColumnGroup,
	KanbanSceneBoard,
	type KanbanSceneCardData,
	type KanbanSceneColumnGroup,
	type KanbanSceneMenuAction,
	type KanbanTaskCardData,
	type KanbanToolData,
} from "@acepe/ui";
import { COLOR_NAMES, Colors } from "@acepe/ui/colors";
import { SvelteMap } from "svelte/reactivity";
import { onDestroy, onMount } from "svelte";
import type { SessionStatus } from "$lib/acp/application/dto/session-status.js";
import type { AgentInfo } from "$lib/acp/logic/agent-manager.js";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getAgentIcon } from "$lib/acp/constants/thread-list-constants.js";
import {
	copySessionToClipboard,
	copyTextToClipboard,
} from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import {
	isActiveCompactActivityKind,
	projectSessionPreviewActivity,
} from "$lib/acp/components/activity-entry/activity-entry-projection.js";
import PermissionBar from "$lib/acp/components/tool-calls/permission-bar.svelte";
import { extractCompactPermissionDisplay } from "$lib/acp/components/tool-calls/permission-display.js";
import { visiblePermissionsForSessionBar } from "$lib/acp/components/tool-calls/permission-visibility.js";
import TodoHeader from "$lib/acp/components/todo-header.svelte";
import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
import AgentSelector from "$lib/acp/components/agent-selector.svelte";
import ProjectSelector from "$lib/acp/components/project-selector.svelte";
import { WorktreeToggleControl } from "$lib/acp/components/worktree-toggle/index.js";
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
import { loadWorktreeEnabled } from "$lib/acp/components/worktree-toggle/worktree-storage.js";
import {
	deriveSessionTitleFromUserInput,
	formatRichSessionTitle,
	formatSessionTitleForDisplay,
} from "$lib/acp/store/session-title-policy.js";
import {
	getAgentPreferencesStore,
	getAgentStore,
	getInteractionStore,
	getPanelStore,
	getPermissionStore,
	getQuestionStore,
	getSessionStore,
	getUnseenStore,
} from "$lib/acp/store/index.js";
import { getQuestionSelectionStore } from "$lib/acp/store/question-selection-store.svelte.js";
import { buildQueueItemQuestionUiState } from "$lib/acp/components/queue/queue-item-question-ui-state.js";
import { buildSessionOperationInteractionSnapshot } from "$lib/acp/store/operation-association.js";
import { getPrimaryQuestionText } from "$lib/acp/store/question-selectors.js";
import {
	buildQueueItem,
	calculateSessionUrgency,
	type QueueSessionSnapshot,
} from "$lib/acp/store/queue/utils.js";
import { buildThreadBoard } from "$lib/acp/store/thread-board/build-thread-board.js";
import type {
	ThreadBoardItem,
	ThreadBoardSource,
} from "$lib/acp/store/thread-board/thread-board-item.js";
import type { ThreadBoardStatus } from "$lib/acp/store/thread-board/thread-board-status.js";
import type { PermissionRequest } from "$lib/acp/types/permission.js";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import { SoundEffect } from "$lib/acp/types/sounds.js";
import { playSound } from "$lib/acp/utils/sound.js";
import { sessionEntriesToMarkdown } from "$lib/acp/utils/session-to-markdown.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { openFileInEditor, tauriClient } from "$lib/utils/tauri-client.js";
import { ResultAsync } from "neverthrow";
import { Robot } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { replyToPlanApprovalRequest } from "$lib/acp/logic/interaction-reply.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import {
	ensureSpawnableAgentSelected,
	getSpawnableSessionAgents,
} from "../../logic/spawnable-agents.js";
import * as m from "$lib/paraglide/messages.js";
import KanbanThreadDialog from "./kanban-thread-dialog.svelte";
import {
	canSendWithoutSession,
	resolveEmptyStateAgentId,
	resolveEmptyStateWorktreePending,
	resolveEmptyStateWorktreePendingForProjectChange,
} from "./logic/empty-state-send-state.js";
import {
	resolveKanbanNewSessionDefaults,
	type KanbanNewSessionRequest,
} from "./kanban-new-session-dialog-state.js";

interface Props {
	projectManager: ProjectManager;
	state: MainAppViewState;
}

let { projectManager, state: appState }: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const interactionStore = getInteractionStore();
const permissionStore = getPermissionStore();
const questionStore = getQuestionStore();
const unseenStore = getUnseenStore();
const selectionStore = getQuestionSelectionStore();
const themeState = useTheme();
const worktreeDefaultStore = getWorktreeDefaultStore();
const isDev = import.meta.env.DEV;

// Override CMD+T to open the kanban new-session dialog instead of spawning a panel
onMount(() => {
	appState.onNewThreadOverride = (request) => {
		pendingNewSessionRequest = request ? request : null;
		handleNewSessionOpenChange(true);
	};
});
onDestroy(() => {
	appState.onNewThreadOverride = null;
});

const KANBAN_NEW_SESSION_PANEL_ID = "kanban-new-session-dialog";
type KanbanThreadDialogMode = "inspect" | "close-panel";
interface OptimisticKanbanCard {
	readonly panelId: string;
	readonly projectPath: string;
	readonly card: KanbanCardData;
}

let newSessionOpen = $state(false);
let newSessionDialogRef = $state<HTMLElement | null>(null);
let pendingNewSessionRequest = $state<KanbanNewSessionRequest | null>(null);
let selectedProjectPath = $state<string | null>(null);
let selectedAgentId = $state<string | null>(null);
let activeWorktreePath = $state<string | null>(null);
let worktreePending = $state(false);
let activeDialogPanelId = $state<string | null>(null);
let activeDialogMode = $state<KanbanThreadDialogMode>("inspect");
let questionIndexBySession = $state(
	new SvelteMap<string, { questionId: string; currentQuestionIndex: number }>()
);

const globalWorktreeDefault = $derived(worktreeDefaultStore.globalDefault);
const projects = $derived(projectManager.projects);
const availableAgents = $derived.by((): AgentInfo[] => {
	return getSpawnableSessionAgents(agentStore.agents, agentPreferencesStore.selectedAgentIds).map(
		(agent) => ({
			id: agent.id,
			name: agent.name,
			icon: agent.icon,
			availability_kind: agent.availability_kind,
		})
	);
});
const availableAgentIds = $derived(availableAgents.map((agent) => agent.id));
const effectiveAgentId = $derived(
	resolveEmptyStateAgentId({
		selectedAgentId,
		availableAgentIds,
	})
);
const selectedProject = $derived.by((): Project | null => {
	if (!selectedProjectPath) {
		return null;
	}

	for (const project of projects) {
		if (project.path === selectedProjectPath) {
			return project;
		}
	}

	return null;
});
const showProjectPicker = $derived(projects.length > 1);
const canShowNewSessionInput = $derived(projects.length > 0 && availableAgents.length > 0);
const effectiveWorktreePending = $derived(worktreePending && activeWorktreePath === null);
const canSendFromNewSession = $derived(
	canSendWithoutSession({
		projectPath: selectedProject ? selectedProject.path : null,
		selectedAgentId: effectiveAgentId,
	})
);
const createDisabled = $derived(!canShowNewSessionInput);

const projectColorsByPath = $derived.by(() => {
	const colors = new Map<string, string>();
	for (const project of projectManager.projects) {
		colors.set(project.path, project.color);
	}
	return colors;
});

const operationStore = sessionStore.getOperationStore();

const SECTION_LABELS: Record<ThreadBoardStatus, () => string> = {
	answer_needed: () => m.queue_group_answer_needed(),
	planning: () => m.queue_group_planning(),
	working: () => m.queue_group_working(),
	needs_review: () => "Needs Review",
	idle: () => "Done",
	error: () => m.queue_group_error(),
};

const SECTION_ORDER: readonly ThreadBoardStatus[] = [
	"answer_needed",
	"planning",
	"working",
	"needs_review",
	"idle",
];

// NOTE: SECTION_LABELS is also defined in queue-section.svelte. Both are
// thin i18n wrappers that cannot be extracted without coupling the store
// layer to Paraglide runtime. Duplication is acceptable here.

function getSessionDisplayName(item: ThreadBoardItem): string {
	return formatSessionTitleForDisplay(item.title, item.projectName);
}

function toSessionStatus(
	runtimeState: ReturnType<typeof sessionStore.getSessionRuntimeState>,
	hotStatus: SessionStatus
): SessionStatus {
	if (runtimeState === null) {
		return hotStatus;
	}

	if (runtimeState.showThinking) {
		return "streaming";
	}

	if (runtimeState.connectionPhase === "failed") {
		return "error";
	}

	if (runtimeState.connectionPhase === "connecting") {
		return "connecting";
	}

	if (runtimeState.activityPhase === "running") {
		return "streaming";
	}

	if (hotStatus === "paused") {
		return "paused";
	}

	if (runtimeState.connectionPhase === "disconnected") {
		return "idle";
	}

	return "ready";
}

const threadBoardSources = $derived.by((): readonly ThreadBoardSource[] => {
	const sources: ThreadBoardSource[] = [];

	for (const panel of panelStore.panels) {
		const sessionId = panel.sessionId;
		if (sessionId === null) {
			continue;
		}

		const identity = sessionStore.getSessionIdentity(sessionId);
		const metadata = sessionStore.getSessionMetadata(sessionId);
		const hotState = sessionStore.getHotState(sessionId);
		const runtimeState = sessionStore.getSessionRuntimeState(sessionId);
		const interactionSnapshot = buildSessionOperationInteractionSnapshot(
			sessionId,
			operationStore,
			interactionStore
		);
		const pendingQuestion = interactionSnapshot.pendingQuestion;
		const pendingPlanApproval = interactionSnapshot.pendingPlanApproval;
		const pendingPermission = interactionSnapshot.pendingPermission;
		const sessionProjectPath = identity ? identity.projectPath : panel.projectPath;
		const sessionAgentId = identity ? identity.agentId : panel.agentId;

		if (sessionProjectPath === null || sessionAgentId === null) {
			continue;
		}

		const snapshot: QueueSessionSnapshot = {
			id: sessionId,
			agentId: sessionAgentId,
			projectPath: sessionProjectPath,
			title: metadata ? metadata.title : panel.sessionTitle,
			entries: sessionStore.getEntries(sessionId),
			isStreaming: runtimeState ? runtimeState.activityPhase === "running" : false,
			isThinking: runtimeState ? runtimeState.showThinking : false,
			status: toSessionStatus(runtimeState, hotState.status),
			updatedAt: metadata ? metadata.updatedAt : new Date(0),
			currentModeId: hotState.currentMode ? hotState.currentMode.id : null,
			connectionError: hotState.connectionError,
		};

		const pendingQuestionText = getPrimaryQuestionText(pendingQuestion);
		const hasPendingQuestion = pendingQuestion !== null;
		const hasPendingPermission = pendingPermission !== null;
		const queueItem = buildQueueItem(
			snapshot,
			panel.id,
			calculateSessionUrgency(snapshot, hasPendingQuestion, pendingQuestionText),
			hasPendingQuestion,
			hasPendingPermission,
			unseenStore.isUnseen(panel.id),
			pendingQuestionText,
			pendingQuestion,
			pendingPlanApproval,
			pendingPermission,
			(projectPath) => {
				const projectColor = projectColorsByPath.get(projectPath);
				return projectColor ? projectColor : null;
			}
		);

		sources.push({
			panelId: panel.id,
			sessionId: queueItem.sessionId,
			agentId: queueItem.agentId,
			autonomousEnabled: hotState.autonomousEnabled,
			projectPath: queueItem.projectPath,
			projectName: queueItem.projectName,
			projectColor: queueItem.projectColor,
			title: queueItem.title,
			lastActivityAt: queueItem.lastActivityAt,
			currentModeId: queueItem.currentModeId,
			currentToolKind: queueItem.currentToolKind,
			currentStreamingToolCall: queueItem.currentStreamingToolCall,
			lastToolKind: queueItem.lastToolKind,
			lastToolCall: queueItem.lastToolCall,
			insertions: queueItem.insertions,
			deletions: queueItem.deletions,
			todoProgress: queueItem.todoProgress,
			connectionError: snapshot.connectionError ? snapshot.connectionError : null,
			state: queueItem.state,
			sequenceId: metadata
				? metadata.sequenceId !== undefined
					? metadata.sequenceId
					: null
				: null,
		});
	}

	return sources;
});

const threadBoard = $derived.by(() => buildThreadBoard(threadBoardSources));

$effect(() => {
	for (const group of threadBoard) {
		if (group.status !== "needs_review") {
			continue;
		}

		for (const item of group.items) {
			unseenStore.markSeen(item.panelId);
		}
	}
});

function mapItemToCard(item: ThreadBoardItem): KanbanCardData {
	const isWorking = isActiveCompactActivityKind(item.state.activity.kind);
	const todoProgress = item.todoProgress
		? {
				current: item.todoProgress.current,
				total: item.todoProgress.total,
				label: item.todoProgress.label,
			}
		: null;
	const activityProjection = projectSessionPreviewActivity({
		activityKind: item.state.activity.kind,
		currentStreamingToolCall: item.currentStreamingToolCall,
		currentToolKind: item.currentToolKind,
		lastToolCall: item.lastToolCall,
		lastToolKind: item.lastToolKind,
		todoProgress,
	});
	const toolDisplay =
		activityProjection.selectedTool && activityProjection.toolKind !== "think"
			? activityProjection.selectedTool
			: null;

	const activityText: string | null = (() => {
		if (!isWorking) return null;
		if (toolDisplay) return null;
		return "Thinking…";
	})();

	const isStreaming = isWorking;
	const taskCard: KanbanTaskCardData | null = (() => {
		if (
			!activityProjection.showTaskSubagentList ||
			activityProjection.taskSubagentTools.length === 0
		) {
			return null;
		}

		const summary = activityProjection.taskDescription
			? activityProjection.taskDescription
			: (activityProjection.taskSubagentSummaries[
					activityProjection.taskSubagentSummaries.length - 1
				] ?? null);
		if (!summary) {
			return null;
		}

		return {
			summary,
			isStreaming,
			latestTool: activityProjection.latestTaskSubagentTool,
			toolCalls: activityProjection.taskSubagentTools,
		};
	})();

	const latestTool: KanbanToolData | null = (() => {
		if (taskCard) return null;
		if (!isWorking) return null;
		return activityProjection.latestTool;
	})();
	const hasUnseenCompletion =
		item.status === "needs_review" ? false : item.state.attention.hasUnseenCompletion;

	const richTitleResult = formatRichSessionTitle(item.title, item.projectName);

	return {
		id: item.sessionId,
		title: richTitleResult.plainText,
		richTitle: richTitleResult.richText,
		agentIconSrc: getAgentIcon(item.agentId, themeState.effectiveTheme),
		agentLabel: item.agentId,
		isAutoMode: item.autonomousEnabled,
		projectName: item.projectName,
		projectColor: item.projectColor,
		activityText,
		isStreaming,
		modeId: item.currentModeId,
		diffInsertions: item.insertions,
		diffDeletions: item.deletions,
		errorText: item.connectionError
			? item.connectionError
			: item.state.connection === "error"
				? "Connection error"
				: null,
		todoProgress,
		taskCard,
		latestTool,
		hasUnseenCompletion,
		sequenceId: item.sequenceId,
	};
}

function getPermissionRequest(item: ThreadBoardItem): PermissionRequest | null {
	const visiblePermission =
		visiblePermissionsForSessionBar(
			permissionStore.getForSession(item.sessionId),
			sessionStore.getEntries(item.sessionId)
		)[0] ?? null;
	if (visiblePermission) {
		return visiblePermission;
	}

	const livePermission = getLiveInteractionSnapshot(item).pendingPermission;
	if (livePermission) {
		return livePermission;
	}

	if (item.state.pendingInput.kind !== "permission") return null;
	return item.state.pendingInput.request;
}

function getPlanApprovalRequest(item: ThreadBoardItem) {
	const liveApproval = getLiveInteractionSnapshot(item).pendingPlanApproval;
	if (liveApproval?.status === "pending") {
		return liveApproval;
	}

	if (item.state.pendingInput.kind !== "plan_approval") return null;
	const snapshotApproval = item.state.pendingInput.request;
	const fallbackApproval =
		interactionStore.planApprovalsPending.get(snapshotApproval.id) ?? snapshotApproval;
	return fallbackApproval.status === "pending" ? fallbackApproval : null;
}

function getPlanApprovalPrompt(item: ThreadBoardItem): string {
	const approval = getPlanApprovalRequest(item);
	if (!approval) {
		return m.tool_create_plan_running();
	}

	const currentTool =
		item.currentStreamingToolCall?.id === approval.tool.callID
			? item.currentStreamingToolCall
			: null;
	if (currentTool?.normalizedQuestions?.[0]?.question) {
		return currentTool.normalizedQuestions[0].question;
	}

	const lastTool = item.lastToolCall?.id === approval.tool.callID ? item.lastToolCall : null;
	return lastTool?.normalizedQuestions?.[0]?.question ?? m.tool_create_plan_running();
}

function buildSceneMenuActions(): readonly KanbanSceneMenuAction[] {
	const actions: KanbanSceneMenuAction[] = [
		{ id: "copy-id", label: m.session_menu_copy_id() },
		{ id: "copy-title", label: m.session_menu_copy_title() },
		{ id: "open-raw", label: m.session_menu_open_raw_file() },
		{ id: "open-in-acepe", label: m.session_menu_open_in_acepe() },
		{ id: "export-markdown", label: m.session_menu_export_markdown() },
		{ id: "export-json", label: m.session_menu_export_json() },
	];

	if (isDev) {
		actions.push({ id: "copy-streaming-log-path", label: "Copy Streaming Log Path" });
		actions.push({ id: "export-raw-streaming", label: m.thread_export_raw_streaming() });
	}

	return actions;
}

function buildSceneCard(card: KanbanCardData): KanbanSceneCardData {
	const item = itemLookup.get(card.id);
	const footer = item ? buildSceneFooter(item) : null;
	const menuActions = item ? buildSceneMenuActions() : [];

	return {
		id: card.id,
		title: card.title,
		agentIconSrc: card.agentIconSrc,
		agentLabel: card.agentLabel,
		isAutoMode: card.isAutoMode,
		projectName: card.projectName,
		projectColor: card.projectColor,
		activityText: card.activityText,
		isStreaming: card.isStreaming,
		modeId: card.modeId,
		diffInsertions: card.diffInsertions,
		diffDeletions: card.diffDeletions,
		errorText: card.errorText,
		todoProgress: card.todoProgress,
		taskCard: card.taskCard,
		latestTool: card.latestTool,
		hasUnseenCompletion: card.hasUnseenCompletion,
		sequenceId: card.sequenceId,
		footer,
		menuActions,
		showCloseAction: item !== undefined,
		hideBody: false,
		flushFooter: false,
	};
}

function buildOptimisticKanbanCards(): readonly OptimisticKanbanCard[] {
	const cards: OptimisticKanbanCard[] = [];

	for (const panel of panelStore.panels) {
		if (panel.sessionId !== null || panel.projectPath === null || panel.selectedAgentId === null) {
			continue;
		}

		const hotState = panelStore.getHotState(panel.id);
		if (hotState.pendingUserEntry === null && hotState.pendingWorktreeSetup === null) {
			continue;
		}

		const project = projects.find((candidate) => candidate.path === panel.projectPath) ?? null;
		const entry = hotState.pendingUserEntry;
		const pendingText =
			entry && entry.type === "user" && entry.message.content.type === "text"
				? entry.message.content.text
				: "";
		const title = formatSessionTitleForDisplay(
			deriveSessionTitleFromUserInput(pendingText),
			project ? project.name : null
		);
		const activityText =
			hotState.pendingWorktreeSetup?.phase === "creating-worktree"
				? "Creating worktree…"
				: "Starting…";

		cards.push({
			panelId: panel.id,
			projectPath: panel.projectPath,
			card: {
				id: panel.id,
				title,
				agentIconSrc: getAgentIcon(panel.selectedAgentId, themeState.effectiveTheme),
				agentLabel: panel.selectedAgentId,
				isAutoMode: hotState.provisionalAutonomousEnabled,
				projectName: project ? project.name : m.project_unknown(),
				projectColor: project ? project.color : Colors[COLOR_NAMES.PINK],
				activityText,
				isStreaming: true,
				modeId: null,
				diffInsertions: 0,
				diffDeletions: 0,
				errorText: null,
				todoProgress: null,
				taskCard: null,
				latestTool: null,
				hasUnseenCompletion: false,
				sequenceId: null,
			},
		});
	}

	return cards;
}

const groups = $derived.by((): readonly KanbanColumnGroup[] => {
	const optimisticKanbanCards = buildOptimisticKanbanCards();

	return SECTION_ORDER.map((sectionId) => {
		const section = threadBoard.find((group) => group.status === sectionId);
		const sectionCards = section ? section.items.map(mapItemToCard) : [];
		return {
			id: sectionId,
			label: SECTION_LABELS[sectionId](),
			items:
				sectionId === "working"
					? optimisticKanbanCards.map((item) => item.card).concat(sectionCards)
					: sectionCards,
		};
	});
});

const itemLookup = $derived.by(() => {
	const map = new Map<string, ThreadBoardItem>();
	for (const section of threadBoard) {
		for (const item of section.items) {
			map.set(item.sessionId, item);
		}
	}
	return map;
});

const liveInteractionBySessionId = $derived.by(() => {
	const map = new Map<string, ReturnType<typeof buildSessionOperationInteractionSnapshot>>();
	for (const panel of panelStore.panels) {
		const sessionId = panel.sessionId;
		if (sessionId === null) {
			continue;
		}
		map.set(
			sessionId,
			buildSessionOperationInteractionSnapshot(sessionId, operationStore, interactionStore)
		);
	}
	return map;
});

const sceneGroups = $derived.by((): readonly KanbanSceneColumnGroup[] => {
	return groups.map((group) => ({
		id: group.id,
		label: group.label,
		items: group.items.map((card) => buildSceneCard(card)),
	}));
});

const optimisticCardLookup = $derived.by(() => {
	const map = new Map<string, OptimisticKanbanCard>();
	for (const item of buildOptimisticKanbanCards()) {
		map.set(item.card.id, item);
	}
	return map;
});

function handleCardClick(cardId: string) {
	const item = itemLookup.get(cardId);
	if (!item) {
		const optimisticCard = optimisticCardLookup.get(cardId);
		if (!optimisticCard) {
			return;
		}
		panelStore.setFocusedViewProjectPath(optimisticCard.projectPath);
		panelStore.movePanelToFront(optimisticCard.panelId);
		panelStore.focusPanel(optimisticCard.panelId);
		return;
	}
	if (item.projectPath) {
		panelStore.setFocusedViewProjectPath(item.projectPath);
	}
	panelStore.movePanelToFront(item.panelId);
	panelStore.focusPanel(item.panelId);
	activeDialogMode = "inspect";
	activeDialogPanelId = item.panelId;
}

function handleCloseSession(item: ThreadBoardItem): void {
	activeDialogMode = "close-panel";
	activeDialogPanelId = item.panelId;
}

function handleDialogDismiss(): void {
	activeDialogPanelId = null;
	activeDialogMode = "inspect";
}

function handleDialogClosePanel(panelId: string): void {
	handleDialogDismiss();
	panelStore.closePanel(panelId);
}

async function handleOpenRawFile(item: ThreadBoardItem): Promise<void> {
	await tauriClient.shell
		.getSessionFilePath(item.sessionId, item.projectPath)
		.andThen((path) => openFileInEditor(path))
		.match(
			() => toast.success(m.thread_export_raw_success()),
			(err) => toast.error(m.session_menu_open_raw_error({ error: err.message }))
		);
}

async function handleOpenInAcepe(item: ThreadBoardItem): Promise<void> {
	await tauriClient.shell.getSessionFilePath(item.sessionId, item.projectPath).match(
		(fullPath) => {
			const parts = fullPath.split(/[/\\]/);
			const fileName = parts.pop() ?? fullPath;
			const dirPath = parts.join("/") || "/";
			panelStore.openFilePanel(fileName, dirPath, { ownerPanelId: item.panelId });
		},
		(err) => toast.error(m.session_menu_open_raw_error({ error: err.message }))
	);
}

async function handleExportMarkdown(item: ThreadBoardItem): Promise<void> {
	const entries = sessionStore.getEntries(item.sessionId);
	const markdown = sessionEntriesToMarkdown(entries);

	await ResultAsync.fromPromise(
		navigator.clipboard.writeText(markdown),
		(error) => new Error(String(error))
	).match(
		() => toast.success(m.session_menu_export_success()),
		(err) => toast.error(m.session_menu_export_error({ error: err.message }))
	);
}

async function handleExportJson(item: ThreadBoardItem): Promise<void> {
	const cold = sessionStore.getSessionCold(item.sessionId);
	if (!cold) {
		toast.error(m.session_menu_export_error({ error: "Session not found" }));
		return;
	}

	const entries = sessionStore.getEntries(item.sessionId);
	await copySessionToClipboard({ ...cold, entries, entryCount: entries.length }).match(
		() => toast.success(m.session_menu_export_success()),
		(err) => toast.error(m.session_menu_export_error({ error: err.message }))
	);
}

async function handleCopyStreamingLogPath(item: ThreadBoardItem): Promise<void> {
	await tauriClient.shell
		.getStreamingLogPath(item.sessionId)
		.andThen((path) => copyTextToClipboard(path))
		.match(
			() => toast.success(m.file_list_copy_path_toast()),
			() => toast.error(m.file_list_copy_path_error())
		);
}

async function handleExportRawStreaming(item: ThreadBoardItem): Promise<void> {
	await tauriClient.shell.openStreamingLog(item.sessionId).match(
		() => undefined,
		(err) => toast.error(m.thread_export_raw_error({ error: err.message }))
	);
}

async function handleCopyValue(value: string): Promise<void> {
	await copyTextToClipboard(value).match(
		() => undefined,
		() => toast.error(m.file_list_copy_path_error())
	);
}

async function handleMenuAction(sessionId: string, actionId: string): Promise<void> {
	const item = itemLookup.get(sessionId);
	if (!item) {
		return;
	}

	switch (actionId) {
		case "copy-id":
			await handleCopyValue(item.sessionId);
			return;
		case "copy-title":
			await handleCopyValue(getSessionDisplayName(item));
			return;
		case "open-raw":
			await handleOpenRawFile(item);
			return;
		case "open-in-acepe":
			await handleOpenInAcepe(item);
			return;
		case "export-markdown":
			await handleExportMarkdown(item);
			return;
		case "export-json":
			await handleExportJson(item);
			return;
		case "copy-streaming-log-path":
			await handleCopyStreamingLogPath(item);
			return;
		case "export-raw-streaming":
			await handleExportRawStreaming(item);
			return;
		default:
			return;
	}
}

function resetNewSessionState(request?: KanbanNewSessionRequest): void {
	const defaults = resolveKanbanNewSessionDefaults({
		projects,
		focusedProjectPath: panelStore.focusedViewProjectPath,
		availableAgents,
		selectedAgentIds: agentPreferencesStore.selectedAgentIds,
		requestedProjectPath: request?.projectPath ?? null,
		requestedAgentId: request?.agentId ?? null,
	});

	selectedProjectPath = defaults.projectPath;
	selectedAgentId = defaults.agentId;
	activeWorktreePath = null;
	worktreePending = defaults.projectPath
		? resolveEmptyStateWorktreePending({
				activeWorktreePath: null,
				globalWorktreeDefault,
				loadEnabled: loadWorktreeEnabled,
				panelId: KANBAN_NEW_SESSION_PANEL_ID,
			})
		: false;
}

function handleNewSessionOpenChange(nextOpen: boolean): void {
	if (nextOpen === newSessionOpen && pendingNewSessionRequest === null) {
		return;
	}

	newSessionOpen = nextOpen;
	if (!nextOpen) {
		pendingNewSessionRequest = null;
		return;
	}

	const request = pendingNewSessionRequest;
	pendingNewSessionRequest = null;
	resetNewSessionState(request ? request : undefined);
}

function handleNewSessionAgentChange(agentId: string): void {
	selectedAgentId = agentId;
}

function handleNewSessionProjectChange(project: Project): void {
	selectedProjectPath = project.path;
	activeWorktreePath = null;
	worktreePending = resolveEmptyStateWorktreePendingForProjectChange({
		globalWorktreeDefault,
		loadEnabled: loadWorktreeEnabled,
		panelId: KANBAN_NEW_SESSION_PANEL_ID,
	});
}

function handleBrowseProject(): void {
	projectManager.importProject();
}

function persistSelectedAgent(agentId: string): void {
	if (agentPreferencesStore.selectedAgentIds.includes(agentId)) {
		return;
	}

	const nextSelectedAgentIds = ensureSpawnableAgentSelected(
		agentPreferencesStore.selectedAgentIds,
		agentId
	);

	void agentPreferencesStore.setSelectedAgentIds(nextSelectedAgentIds).match(
		() => undefined,
		() => undefined
	);
}

function handleNewSessionWillSend(): string | null {
	const projectPath = selectedProject ? selectedProject.path : null;
	if (!effectiveAgentId || !projectPath) {
		return null;
	}

	persistSelectedAgent(effectiveAgentId);
	playSound(SoundEffect.Paste);
	const optimisticPanel = panelStore.spawnPanel({
		projectPath,
		selectedAgentId: effectiveAgentId,
	});
	newSessionOpen = false;
	return optimisticPanel.id;
}

function handleNewSessionCreated(sessionId: string, panelId?: string | null): void {
	if (panelId) {
		panelStore.updatePanelSession(panelId, sessionId);
		panelStore.focusPanel(panelId);
		return;
	}

	newSessionOpen = false;
	panelStore.openSession(sessionId, 450);
}

function handleNewSessionSendError(panelId: string | null): void {
	if (!panelId) {
		return;
	}

	const restore = panelStore.consumePendingComposerRestore(panelId);
	if (restore !== null) {
		panelStore.setPendingComposerRestore(KANBAN_NEW_SESSION_PANEL_ID, restore);
		panelStore.setMessageDraft(KANBAN_NEW_SESSION_PANEL_ID, restore.draft);
	}

	panelStore.closePanel(panelId);
	newSessionOpen = true;
}

function resolveQuestionId(question: QuestionRequest): string {
	const callId = question.tool?.callID;
	return callId ? callId : question.id ? question.id : "";
}

function getLiveInteractionSnapshot(item: ThreadBoardItem) {
	return (
		liveInteractionBySessionId.get(item.sessionId) ??
		buildSessionOperationInteractionSnapshot(item.sessionId, operationStore, interactionStore)
	);
}

function getQuestionRequest(item: ThreadBoardItem): QuestionRequest | null {
	const liveQuestion = getLiveInteractionSnapshot(item).pendingQuestion;
	if (liveQuestion) {
		return liveQuestion;
	}

	if (item.state.pendingInput.kind !== "question") return null;
	return item.state.pendingInput.request;
}

function getQuestionUiState(item: ThreadBoardItem) {
	const pendingQuestion = getQuestionRequest(item);
	if (!pendingQuestion) return null;
	const questionId = resolveQuestionId(pendingQuestion);
	const currentQuestionIndex = getCurrentQuestionIndex(item);
	return buildQueueItemQuestionUiState({
		pendingQuestion,
		questionId,
		currentQuestionIndex,
		questionColors: [Colors.green, Colors.red, Colors.pink, Colors.orange],
		selectionReader: {
			hasSelections(questionId: string, questionIndex: number) {
				return selectionStore.hasSelections(questionId, questionIndex);
			},
			isOptionSelected(questionId: string, questionIndex: number, optionLabel: string) {
				return selectionStore.isOptionSelected(questionId, questionIndex, optionLabel);
			},
			isOtherActive(questionId: string, questionIndex: number) {
				return selectionStore.isOtherActive(questionId, questionIndex);
			},
			getOtherText(questionId: string, questionIndex: number) {
				return selectionStore.getOtherText(questionId, questionIndex);
			},
		},
	});
}

function buildSceneFooter(item: ThreadBoardItem) {
	const permission = getPermissionRequest(item);
	if (permission) {
		const compactDisplay = extractCompactPermissionDisplay(permission, item.projectPath);
		const sessionProgress = permissionStore.getSessionProgress(item.sessionId);
		const progress = sessionProgress
			? {
					current:
						sessionProgress.completed + 1 <= sessionProgress.total
							? sessionProgress.completed + 1
							: sessionProgress.total,
					total: sessionProgress.total,
					label: `Permission ${sessionProgress.total}`,
				}
			: null;

		return {
			kind: "permission" as const,
			label: compactDisplay.label,
			command: compactDisplay.command,
			filePath: compactDisplay.filePath,
			toolKind: toScenePermissionToolKind(compactDisplay.kind),
			progress,
			allowAlwaysLabel:
				permission.always && permission.always.length > 0 ? m.permission_always_allow() : undefined,
			approveLabel: m.permission_allow(),
			rejectLabel: m.permission_deny(),
		};
	}

	if (item.state.pendingInput.kind === "plan_approval") {
		return {
			kind: "plan_approval" as const,
			prompt: getPlanApprovalPrompt(item),
			approveLabel: m.plan_sidebar_build(),
			rejectLabel: "Cancel",
		};
	}

	const questionUiState = getQuestionUiState(item);
	if (questionUiState?.currentQuestion) {
		return {
			kind: "question" as const,
			currentQuestion: questionUiState.currentQuestion,
			totalQuestions: questionUiState.totalQuestions,
			hasMultipleQuestions: questionUiState.hasMultipleQuestions,
			currentQuestionIndex: getCurrentQuestionIndex(item),
			questionId: getPendingQuestionId(item),
			questionProgress: questionUiState.questionProgress,
			currentQuestionAnswered: questionUiState.currentQuestionAnswered,
			currentQuestionOptions: questionUiState.currentQuestionOptions,
			otherText: questionUiState.otherText,
			otherPlaceholder: m.question_other_placeholder(),
			showOtherInput: questionUiState.showOtherInput,
			showSubmitButton: questionUiState.showSubmitButton,
			canSubmit: questionUiState.canSubmit,
			submitLabel: m.common_submit(),
		};
	}

	return null;
}

function toScenePermissionToolKind(kind: string): AgentToolKind | null {
	switch (kind) {
		case "read":
		case "edit":
		case "delete":
		case "execute":
		case "search":
		case "fetch":
		case "web_search":
			return kind;
		case "move":
		case "other":
			return "other";
		default:
			return null;
	}
}

function getCurrentQuestionIndex(item: ThreadBoardItem): number {
	if (item.state.pendingInput.kind !== "question") {
		return 0;
	}

	const pendingQuestion = item.state.pendingInput.request;
	const questionId = resolveQuestionId(pendingQuestion);
	const current = questionIndexBySession.get(item.sessionId);
	if (!current || current.questionId !== questionId) {
		return 0;
	}

	const maxQuestionIndex = pendingQuestion.questions.length - 1;
	if (current.currentQuestionIndex < 0 || current.currentQuestionIndex > maxQuestionIndex) {
		return 0;
	}

	return current.currentQuestionIndex;
}

function setCurrentQuestionIndex(
	sessionId: string,
	questionId: string,
	currentQuestionIndex: number
): void {
	questionIndexBySession.set(sessionId, { questionId, currentQuestionIndex });
}

function getPendingQuestionId(item: ThreadBoardItem): string {
	if (item.state.pendingInput.kind !== "question") {
		return "";
	}
	return resolveQuestionId(item.state.pendingInput.request);
}

function handleOptionSelect(sessionId: string, currentQuestionIndex: number, optionLabel: string) {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const pendingQuestion = item.state.pendingInput.request;
	const q = pendingQuestion.questions[currentQuestionIndex];
	if (!q) return;
	const questionId = resolveQuestionId(pendingQuestion);
	if (q.multiSelect) {
		selectionStore.toggleOption(questionId, currentQuestionIndex, optionLabel);
		return;
	}
	selectionStore.setSingleOption(questionId, currentQuestionIndex, optionLabel);

	const isSingleQuestionSingleSelect = pendingQuestion.questions.length === 1;
	if (isSingleQuestionSingleSelect) {
		requestAnimationFrame(() => {
			handleSubmitQuestion(sessionId);
		});
		return;
	}

	if (currentQuestionIndex < pendingQuestion.questions.length - 1) {
		setCurrentQuestionIndex(sessionId, questionId, currentQuestionIndex + 1);
	}
}

function handleOtherInput(sessionId: string, currentQuestionIndex: number, value: string) {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const pendingQuestion = item.state.pendingInput.request;
	const currentQuestion = pendingQuestion.questions[currentQuestionIndex];
	if (!currentQuestion) return;
	const questionId = resolveQuestionId(pendingQuestion);
	selectionStore.setOtherText(questionId, currentQuestionIndex, value);
	if (value.trim() && !selectionStore.isOtherActive(questionId, currentQuestionIndex)) {
		selectionStore.setOtherModeActive(questionId, currentQuestionIndex, true);
		if (!currentQuestion.multiSelect) {
			selectionStore.clearSelections(questionId, currentQuestionIndex);
		}
	}
	if (!value.trim() && selectionStore.isOtherActive(questionId, currentQuestionIndex)) {
		selectionStore.setOtherModeActive(questionId, currentQuestionIndex, false);
	}
}

function handleOtherKeydown(sessionId: string, currentQuestionIndex: number, key: string) {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const pendingQuestion = item.state.pendingInput.request;
	const questionId = resolveQuestionId(pendingQuestion);
	const otherValue = selectionStore.getOtherText(questionId, currentQuestionIndex).trim();
	if (key === "Enter" && otherValue) {
		if (pendingQuestion.questions.length === 1) {
			handleSubmitQuestion(sessionId);
		} else if (currentQuestionIndex < pendingQuestion.questions.length - 1) {
			setCurrentQuestionIndex(sessionId, questionId, currentQuestionIndex + 1);
		} else {
			handleSubmitQuestion(sessionId);
		}
	}
	if (key === "Escape") {
		selectionStore.setOtherModeActive(questionId, currentQuestionIndex, false);
	}
}

function handlePrevQuestion(sessionId: string, currentQuestionIndex: number): void {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const questionId = resolveQuestionId(item.state.pendingInput.request);
	if (currentQuestionIndex > 0) {
		setCurrentQuestionIndex(sessionId, questionId, currentQuestionIndex - 1);
	}
}

function handleNextQuestion(
	sessionId: string,
	currentQuestionIndex: number,
	totalQuestions: number
): void {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const questionId = resolveQuestionId(item.state.pendingInput.request);
	if (currentQuestionIndex < totalQuestions - 1) {
		setCurrentQuestionIndex(sessionId, questionId, currentQuestionIndex + 1);
	}
}

function handleSubmitQuestion(sessionId: string) {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const pendingQuestion = item.state.pendingInput.request;
	const questionId = resolveQuestionId(pendingQuestion);
	if (!selectionStore.hasAnySelections(questionId)) return;
	const answers = pendingQuestion.questions.map((q, questionIndex) => ({
		questionIndex,
		answers: selectionStore.getAnswers(questionId, questionIndex, q.multiSelect),
	}));
	selectionStore.clearQuestion(questionId);
	questionIndexBySession.delete(sessionId);
	questionStore.reply(pendingQuestion.id, answers, pendingQuestion.questions);
}

function handleApprovePlanApproval(sessionId: string): void {
	const item = itemLookup.get(sessionId);
	const approval = item ? getPlanApprovalRequest(item) : null;
	if (!approval) return;
	interactionStore.setPlanApprovalStatus(approval.id, "approved");

	void replyToPlanApprovalRequest(approval, true, false).match(
		() => undefined,
		() => {
			interactionStore.setPlanApprovalStatus(approval.id, "pending");
		}
	);
}

function handleRejectPlanApproval(sessionId: string): void {
	const item = itemLookup.get(sessionId);
	const approval = item ? getPlanApprovalRequest(item) : null;
	if (!approval) return;
	interactionStore.setPlanApprovalStatus(approval.id, "rejected");

	void replyToPlanApprovalRequest(approval, false, false).match(
		() => undefined,
		() => {
			interactionStore.setPlanApprovalStatus(approval.id, "pending");
		}
	);
}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
	<Dialog bind:open={newSessionOpen} onOpenChange={handleNewSessionOpenChange}>
		<DialogContent
			bind:ref={newSessionDialogRef}
			showCloseButton={false}
			class="overflow-hidden max-w-[34rem] gap-0 rounded-2xl !border-0 bg-background p-0 shadow-xl !backdrop-blur-none"
			portalProps={{ disabled: true }}
			onOpenAutoFocus={(e: Event) => {
				e.preventDefault();
				requestAnimationFrame(() => {
					newSessionDialogRef?.querySelector<HTMLElement>("[contenteditable]")?.focus();
				});
			}}
		>
			<div class="flex w-full flex-col px-2 py-2">
				{#if canShowNewSessionInput}
					<AgentInput
						panelId={KANBAN_NEW_SESSION_PANEL_ID}
						projectPath={selectedProject ? selectedProject.path : undefined}
						projectName={selectedProject ? selectedProject.name : undefined}
						selectedAgentId={effectiveAgentId}
						voiceSessionId={KANBAN_NEW_SESSION_PANEL_ID}
						disableSend={!canSendFromNewSession}
						{availableAgents}
						onAgentChange={handleNewSessionAgentChange}
						onSessionCreated={handleNewSessionCreated}
						onWillSend={handleNewSessionWillSend}
						onSendError={handleNewSessionSendError}
						worktreePath={activeWorktreePath ? activeWorktreePath : undefined}
						worktreePending={effectiveWorktreePending}
						onWorktreeCreated={(path) => {
							activeWorktreePath = path;
							worktreePending = false;
						}}
					>
						{#snippet agentProjectPicker()}
							<AgentSelector
								{availableAgents}
								currentAgentId={effectiveAgentId}
								onAgentChange={handleNewSessionAgentChange}
							/>
							{#if showProjectPicker}
								<div class="h-full w-px bg-border/50"></div>
								<ProjectSelector
									selectedProject={selectedProject}
									recentProjects={projects}
									onProjectChange={handleNewSessionProjectChange}
									onBrowse={handleBrowseProject}
								/>
							{/if}
						{/snippet}
					</AgentInput>
					{#if selectedProject}
						<div class="mt-2 flex h-7 items-center rounded-b-lg">
							<WorktreeToggleControl
								panelId={KANBAN_NEW_SESSION_PANEL_ID}
								projectPath={selectedProject.path}
								projectName={selectedProject.name}
								activeWorktreePath={activeWorktreePath}
								hasEdits={false}
								hasMessages={false}
								{globalWorktreeDefault}
								variant="minimal"
								onWorktreeCreated={(info) => {
									activeWorktreePath = info.directory;
									worktreePending = false;
								}}
								onWorktreeRenamed={(info) => {
									activeWorktreePath = info.directory;
								}}
								onPendingChange={(pending) => {
									worktreePending = pending;
								}}
							/>
						</div>
					{/if}
				{:else}
					<div class="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
						Add at least one project and one available agent to start a session.
					</div>
				{/if}
			</div>
		</DialogContent>
	</Dialog>

	<div class="min-h-0 min-w-0 flex-1 overflow-hidden">
		<KanbanSceneBoard
			groups={sceneGroups}
			emptyHint="No sessions"
			onCardClick={handleCardClick}
			onCardClose={(cardId: string) => {
				const item = itemLookup.get(cardId);
				if (item) {
					handleCloseSession(item);
				}
			}}
			onMenuAction={(cardId: string, actionId: string) => {
				void handleMenuAction(cardId, actionId);
			}}
			onQuestionOptionSelect={handleOptionSelect}
			onQuestionOtherInput={handleOtherInput}
			onQuestionOtherKeydown={handleOtherKeydown}
			onQuestionSubmit={handleSubmitQuestion}
			onQuestionPrev={handlePrevQuestion}
			onQuestionNext={handleNextQuestion}
			onPlanApprove={handleApprovePlanApproval}
			onPlanReject={handleRejectPlanApproval}
		>
			{#snippet todoSectionRenderer(card: KanbanSceneCardData)}
				{@const item = itemLookup.get(card.id)}
				{@const hotState = item ? sessionStore.getHotState(item.sessionId) : null}
				{#if item}
					{@const runtimeState = sessionStore.getSessionRuntimeState(item.sessionId)}
					{@const todoSessionStatus = toSessionStatus(runtimeState, hotState ? hotState.status : "idle")}
					<TodoHeader
						sessionId={item.sessionId}
						entries={sessionStore.getEntries(item.sessionId)}
						isConnected={item.state.connection === "connected"}
						status={todoSessionStatus}
						isStreaming={card.isStreaming}
						compact={true}
					/>
				{/if}
			{/snippet}
			{#snippet permissionFooterRenderer(card: KanbanSceneCardData, _permissionFooterData)}
				{@const item = itemLookup.get(card.id)}
				{#if item}
					<PermissionBar
						sessionId={item.sessionId}
						projectPath={item.projectPath}
						showCommandWhenRepresented={true}
						showCompactEditPreview={true}
					/>
				{/if}
			{/snippet}
		</KanbanSceneBoard>
	</div>

	<KanbanThreadDialog
		panelId={activeDialogPanelId}
		mode={activeDialogMode}
		{projectManager}
		mainAppState={appState}
		onDismiss={handleDialogDismiss}
		onClosePanel={handleDialogClosePanel}
	/>
</div>
