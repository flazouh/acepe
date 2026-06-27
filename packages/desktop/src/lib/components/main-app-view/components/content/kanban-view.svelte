<script lang="ts">
import {
	KanbanSceneBoard,
	type KanbanSceneCardData,
	type KanbanSceneColumnData,
	type KanbanSceneModel,
} from "@acepe/ui";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Colors } from "@acepe/ui/colors";
import { SvelteMap } from "svelte/reactivity";
import { onDestroy, onMount } from "svelte";
import type { AgentInfo } from "$lib/acp/logic/agent-manager.js";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { PreparedWorktreeLaunch } from "$lib/acp/types/worktree-info.js";
import { getProviderBrandIcon } from "$lib/acp/constants/thread-list-constants.js";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import PermissionBar from "$lib/acp/components/tool-calls/permission-bar.svelte";
import { extractCompactPermissionDisplay } from "$lib/acp/components/tool-calls/permission-display.js";
import TodoHeader from "$lib/acp/components/todo-header.svelte";
import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
import AgentSelector from "$lib/acp/components/agent-selector.svelte";
import ProjectSelector from "$lib/acp/components/project-selector.svelte";
import PreSessionWorktreeCard from "$lib/acp/components/agent-panel/components/pre-session-worktree-card.svelte";
import PrChecksSurface from "$lib/acp/components/shared/pr-checks-surface.svelte";
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree/worktree-default-store.svelte.js";
import { loadWorktreeEnabled } from "$lib/acp/components/worktree/worktree-storage.js";
import { formatSessionTitleForDisplay } from "$lib/acp/store/session-title-policy.js";
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
import type { SessionOperationInteractionSnapshot } from "$lib/acp/store/operation-association.js";
import { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";
import { buildQueueItem, calculateSessionUrgency } from "$lib/acp/store/queue/utils.js";
import { buildThreadBoard } from "$lib/acp/store/thread-board/build-thread-board.js";
import type {
	ThreadBoardItem,
	ThreadBoardSource,
} from "$lib/acp/store/thread-board/thread-board-item.js";
import type { PermissionRequest } from "$lib/acp/types/permission.js";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { Plus } from "@acepe/ui/icons";
import { toast } from "svelte-sonner";
import { replyToPlanApprovalRequest } from "$lib/acp/logic/interaction-reply.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import {
	ensureSpawnableAgentSelected,
	getSpawnableSessionAgents,
} from "../../logic/spawnable-agents.js";
import { createKanbanExportHandlers } from "./kanban-export-handlers.js";
import KanbanThreadDialog from "./kanban-thread-dialog.svelte";
import { canSendWithoutSession, resolveEmptyStateAgentId } from "./logic/empty-state-send-state.js";
import {
	acknowledgeExplicitPanelReveal,
	applyCompletionAttentionAction,
	performExplicitPanelReveal,
} from "../../logic/completion-acknowledgement.js";
import {
	buildKanbanNewSessionProjectChangeState,
	buildKanbanNewSessionResetState,
	resolveKanbanNewSessionOpenChangeAction,
	type KanbanNewSessionRequest,
} from "./kanban-new-session-dialog-state.js";
import { KANBAN_SESSION_PANEL_WIDTH } from "./kanban-session-panel-width.js";
import {
	buildKanbanCard,
	buildKanbanSceneCard as buildKanbanSceneCardModel,
	buildKanbanSceneMenuActions,
	buildOptimisticKanbanCards as buildOptimisticKanbanCardModels,
	type OptimisticKanbanCard,
} from "./logic/kanban-card-model.js";
import { completeKanbanNewSessionHandoff } from "./logic/kanban-new-session-handoff.js";
import { buildKanbanSceneColumns, buildKanbanSceneModel } from "./logic/kanban-scene-model.js";
import {
	buildKanbanPermissionFooter,
	buildKanbanPlanApprovalFooter,
	buildKanbanQuestionFooter,
	resolveKanbanPlanApprovalPrompt,
	resolveKanbanQuestionId,
	resolveKanbanQuestionIndex,
} from "./logic/kanban-footer-model.js";
import {
	buildKanbanOptionSelectCommands,
	buildKanbanOtherInputCommands,
	buildKanbanOtherKeydownCommands,
	buildKanbanQuestionNavigationCommands,
	buildKanbanQuestionSubmitPayload,
	type KanbanQuestionInteractionCommand,
} from "./logic/kanban-question-interaction-model.js";

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

function getCanonicalAgentIcon(agentId: string | null | undefined): string | null {
	const providerBrand = agentStore.getProviderMetadata(agentId)?.providerBrand ?? null;

	return getProviderBrandIcon(providerBrand, themeState.effectiveTheme);
}
const worktreeDefaultStore = getWorktreeDefaultStore();
const isDev = import.meta.env.DEV;

// Override CMD+T to open the kanban new-session dialog instead of spawning a panel
onMount(() => {
	appState.onNewThreadOverride = (request) => {
		openNewSessionDialog(request ? request : undefined);
	};
});
onDestroy(() => {
	appState.onNewThreadOverride = null;
});

const KANBAN_NEW_SESSION_PANEL_ID = "kanban-new-session-dialog";
type KanbanThreadDialogMode = "inspect" | "close-panel";

let newSessionOpen = $state(false);
let newSessionDialogRef = $state<HTMLElement | null>(null);
let pendingNewSessionRequest = $state<KanbanNewSessionRequest | null>(null);
let newSessionComposerKey = $state(0);
let newSessionInitialModeId = $state<string | null>(CanonicalModeId.BUILD);
let selectedProjectPath = $state<string | null>(null);
let selectedAgentId = $state<string | null>(null);
let activeWorktreePath = $state<string | null>(null);
let worktreePending = $state(false);
let preparedWorktreeLaunch = $state<PreparedWorktreeLaunch | null>(null);
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
		defaultAgentId: agentPreferencesStore.defaultAgentId,
		availableAgentIds,
	})
);
const selectedProject = $derived.by((): Project | null => {
	if (!selectedProjectPath) {
		return null;
	}

	return projectManager.getProject(selectedProjectPath) ?? null;
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

function getSessionDisplayName(item: ThreadBoardItem): string {
	return formatSessionTitleForDisplay(item.title, item.projectName);
}

const threadBoardSources = $derived.by((): readonly ThreadBoardSource[] => {
	const sources: ThreadBoardSource[] = [];

	for (const panel of panelStore.panels) {
		const sessionId = panel.sessionId;
		if (sessionId === null) {
			continue;
		}

		const identity = sessionStore.read.getSessionIdentity(sessionId);
		const metadata = sessionStore.read.getSessionMetadata(sessionId);
		const sessionProjectPath = identity ? identity.projectPath : panel.projectPath;
		const sessionAgentId = identity ? identity.agentId : panel.agentId;

		if (sessionProjectPath === null || sessionAgentId === null) {
			continue;
		}

		const presentation = sessionStore.presentation.getSessionQueuePresentation({
			sessionId,
			agentId: sessionAgentId,
			projectPath: sessionProjectPath,
			title: metadata ? metadata.title : panel.sessionTitle,
			updatedAt: metadata ? metadata.updatedAt : new Date(0),
			interactionStore,
			hasUnseenCompletion: unseenStore.isUnseen(panel.id),
		});
		const snapshot = presentation.session;
		const queueItem = buildQueueItem(
			snapshot,
			panel.id,
			calculateSessionUrgency(
				snapshot,
				presentation.hasPendingQuestion,
				presentation.pendingQuestionText
			),
			presentation.hasPendingQuestion,
			presentation.hasPendingPermission,
			snapshot.state.attention.hasUnseenCompletion,
			presentation.pendingQuestionText,
			presentation.pendingQuestion,
			presentation.pendingPlanApproval,
			presentation.pendingPermission,
			(projectPath) => {
				const projectColor = projectColorsByPath.get(projectPath);
				return projectColor ? projectColor : null;
			},
			(projectPath) => {
				const project = projectManager.getProject(projectPath);
				return project ? (project.iconPath ?? null) : null;
			},
			presentation.pendingComputerPermission
		);

		sources.push({
			panelId: panel.id,
			sessionId: queueItem.sessionId,
			agentId: queueItem.agentId,
			autonomousEnabled: sessionStore.read.getSessionAutonomousEnabled(sessionId),
			projectPath: queueItem.projectPath,
			projectName: queueItem.projectName,
			projectColor: queueItem.projectColor,
			projectIconSrc: queueItem.projectIconSrc,
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
			activeTurnFailure: snapshot.activeTurnFailure ?? null,
			sessionStatus: queueItem.status,
			state: queueItem.state,
			workBucket: queueItem.workBucket,
			sequenceId: metadata
				? metadata.sequenceId !== undefined
					? metadata.sequenceId
					: null
				: null,
			worktreePath: identity?.worktreePath ? identity.worktreePath : null,
			worktreeDeleted: metadata?.worktreeDeleted ?? false,
			linkedPr: metadata?.linkedPr ?? null,
		});
	}

	return sources;
});

const threadBoard = $derived.by(() => buildThreadBoard(threadBoardSources));

function mapItemToCard(item: ThreadBoardItem) {
	return buildKanbanCard({
		item,
		getAgentIcon: getCanonicalAgentIcon,
		onOpenPrCheckDetails: (detailsUrl) => {
			void openUrl(detailsUrl).catch(() => {});
		},
	});
}

function getPermissionRequest(item: ThreadBoardItem): PermissionRequest | null {
	const visiblePermission =
		sessionStore.read.getVisiblePermissionsForSessionBar(
			permissionStore.getForSession(item.sessionId)
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
	return resolveKanbanPlanApprovalPrompt({
		approval: getPlanApprovalRequest(item),
		currentStreamingToolCall: item.currentStreamingToolCall,
		lastToolCall: item.lastToolCall,
	});
}

function buildSceneCard(card: ReturnType<typeof mapItemToCard>): KanbanSceneCardData {
	const item = itemLookup.get(card.id);
	const footer = item ? buildSceneFooter(item) : null;
	const menuActions = item ? buildKanbanSceneMenuActions(isDev) : [];

	return buildKanbanSceneCardModel({
		card,
		footer,
		menuActions,
		showCloseAction: item !== undefined,
	});
}

function buildOptimisticKanbanCards(): readonly OptimisticKanbanCard[] {
	const sessionIdsWithThreadBoardSource = new Set<string>();
	for (const source of threadBoardSources) {
		sessionIdsWithThreadBoardSource.add(source.sessionId);
	}

	return buildOptimisticKanbanCardModels({
		panels: panelStore.panels,
		sessionIdsWithThreadBoardSource,
		getProject: (projectPath) => projectManager.getProject(projectPath),
		getPanelHotState: (panelId) => panelStore.getHotState(panelId),
		getAgentIcon: getCanonicalAgentIcon,
	});
}

const sceneColumns = $derived.by((): readonly KanbanSceneColumnData[] => {
	return buildKanbanSceneColumns();
});

const sceneModel = $derived.by((): KanbanSceneModel => {
	const optimisticKanbanCards = buildOptimisticKanbanCards();

	return buildKanbanSceneModel({
		columns: sceneColumns,
		optimisticCards: optimisticKanbanCards,
		threadBoard,
		buildOptimisticSceneCard: (optimisticCard) => buildSceneCard(optimisticCard.card),
		buildSessionSceneCard: (item) => buildSceneCard(mapItemToCard(item)),
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
	const map = new Map<string, SessionOperationInteractionSnapshot>();
	for (const panel of panelStore.panels) {
		const sessionId = panel.sessionId;
		if (sessionId === null) {
			continue;
		}
		map.set(
			sessionId,
			sessionStore.presentation.getSessionOperationInteractionSnapshot(sessionId, interactionStore)
		);
	}
	return map;
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
	applyCompletionAttentionAction(unseenStore, item.panelId, { kind: "explicit-reveal" });
	activeDialogMode = "inspect";
	activeDialogPanelId = item.panelId;
}

function handlePrFooterOpen(cardId: string): void {
	const item = itemLookup.get(cardId);
	if (!item || item.linkedPr == null) {
		return;
	}

	panelStore.openGitDialog(item.projectPath, undefined, {
		section: "prs",
		prNumber: item.linkedPr.prNumber,
	});
}

function handlePrFooterOpenExternal(cardId: string): void {
	const item = itemLookup.get(cardId);
	if (!item || item.linkedPr?.url == null) {
		return;
	}

	void openUrl(item.linkedPr.url).catch(() => {});
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

const {
	handleOpenRawFile,
	handleOpenInAcepe,
	handleExportMarkdown,
	handleExportJson,
	handleCopyStreamingLogPath,
	handleExportRawStreaming,
} = createKanbanExportHandlers({ sessionStore, panelStore });

async function handleCopyValue(value: string): Promise<void> {
	await copyTextToClipboard(value).match(
		() => undefined,
		() => toast.error("Failed to copy path")
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
	const nextState = buildKanbanNewSessionResetState({
		projects,
		focusedProjectPath: panelStore.focusedViewProjectPath,
		availableAgents,
		selectedAgentIds: agentPreferencesStore.selectedAgentIds,
		defaultAgentId: agentPreferencesStore.defaultAgentId,
		request: request ?? null,
		currentComposerKey: newSessionComposerKey,
		fallbackModeId: CanonicalModeId.BUILD,
		globalWorktreeDefault,
		loadWorktreeEnabled: loadWorktreeEnabled,
		panelId: KANBAN_NEW_SESSION_PANEL_ID,
	});

	selectedProjectPath = nextState.selectedProjectPath;
	selectedAgentId = nextState.selectedAgentId;
	newSessionInitialModeId = nextState.initialModeId;
	newSessionComposerKey = nextState.composerKey;
	activeWorktreePath = nextState.activeWorktreePath;
	preparedWorktreeLaunch = nextState.preparedWorktreeLaunch;
	worktreePending = nextState.worktreePending;
}

function handleNewSessionOpenChange(nextOpen: boolean): void {
	const action = resolveKanbanNewSessionOpenChangeAction({
		nextOpen,
		currentOpen: newSessionOpen,
		pendingRequest: pendingNewSessionRequest,
	});

	if (action.kind === "ignore") {
		return;
	}

	pendingNewSessionRequest = null;
	newSessionOpen = nextOpen;
	if (action.kind === "open") {
		resetNewSessionState(action.request ? action.request : undefined);
	}
}

function openNewSessionDialog(request?: KanbanNewSessionRequest): void {
	pendingNewSessionRequest = request ? request : null;
	handleNewSessionOpenChange(true);
}

function handleKanbanColumnCreate(modeId: CanonicalModeId): void {
	openNewSessionDialog({ modeId });
}

function handleNewSessionAgentChange(agentId: string): void {
	selectedAgentId = agentId;
}

function handleNewSessionProjectChange(project: Project): void {
	const nextState = buildKanbanNewSessionProjectChangeState({
		projectPath: project.path,
		globalWorktreeDefault,
		loadWorktreeEnabled: loadWorktreeEnabled,
		panelId: KANBAN_NEW_SESSION_PANEL_ID,
	});
	selectedProjectPath = nextState.selectedProjectPath;
	activeWorktreePath = nextState.activeWorktreePath;
	preparedWorktreeLaunch = nextState.preparedWorktreeLaunch;
	worktreePending = nextState.worktreePending;
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
	const optimisticPanel = panelStore.spawnPanel({
		projectPath,
		selectedAgentId: effectiveAgentId,
		pendingWorktreeEnabled: effectiveWorktreePending,
	});
	newSessionOpen = false;
	return optimisticPanel.id;
}

function handleNewSessionCreated(sessionId: string, panelId?: string | null): void {
	preparedWorktreeLaunch = null;
	newSessionOpen = false;
	completeKanbanNewSessionHandoff({
		panelStore,
		panelId,
		sessionId,
		sessionPanelWidth: KANBAN_SESSION_PANEL_WIDTH,
	});
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
	return resolveKanbanQuestionId(question);
}

function getLiveInteractionSnapshot(item: ThreadBoardItem) {
	return (
		liveInteractionBySessionId.get(item.sessionId) ??
		sessionStore.presentation.getSessionOperationInteractionSnapshot(item.sessionId, interactionStore)
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

		return buildKanbanPermissionFooter({
			permission,
			compactDisplay,
			sessionProgress,
		});
	}

	if (item.state.pendingInput.kind === "plan_approval") {
		return buildKanbanPlanApprovalFooter(getPlanApprovalPrompt(item));
	}

	const questionUiState = getQuestionUiState(item);
	return buildKanbanQuestionFooter({
		questionUiState,
		currentQuestionIndex: getCurrentQuestionIndex(item),
		questionId: getPendingQuestionId(item),
	});
}

function getCurrentQuestionIndex(item: ThreadBoardItem): number {
	return resolveKanbanQuestionIndex({
		pendingQuestion:
			item.state.pendingInput.kind === "question" ? item.state.pendingInput.request : null,
		current: questionIndexBySession.get(item.sessionId),
	});
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

function applyQuestionInteractionCommands(
	commands: readonly KanbanQuestionInteractionCommand[]
): void {
	for (const command of commands) {
		switch (command.kind) {
			case "toggle-option":
				selectionStore.toggleOption(command.questionId, command.questionIndex, command.optionLabel);
				break;
			case "set-single-option":
				selectionStore.setSingleOption(
					command.questionId,
					command.questionIndex,
					command.optionLabel
				);
				break;
			case "set-current-question-index":
				setCurrentQuestionIndex(command.sessionId, command.questionId, command.questionIndex);
				break;
			case "submit-question":
				if (command.defer) {
					requestAnimationFrame(() => {
						handleSubmitQuestion(command.sessionId);
					});
				} else {
					handleSubmitQuestion(command.sessionId);
				}
				break;
			case "set-other-text":
				selectionStore.setOtherText(command.questionId, command.questionIndex, command.value);
				break;
			case "set-other-active":
				selectionStore.setOtherModeActive(
					command.questionId,
					command.questionIndex,
					command.active
				);
				break;
			case "clear-selections":
				selectionStore.clearSelections(command.questionId, command.questionIndex);
				break;
		}
	}
}

function handleOptionSelect(sessionId: string, currentQuestionIndex: number, optionLabel: string) {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	applyQuestionInteractionCommands(
		buildKanbanOptionSelectCommands({
			sessionId,
			pendingQuestion: item.state.pendingInput.request,
			currentQuestionIndex,
			optionLabel,
		})
	);
}

function handleOtherInput(sessionId: string, currentQuestionIndex: number, value: string) {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const pendingQuestion = item.state.pendingInput.request;
	const questionId = resolveQuestionId(pendingQuestion);
	applyQuestionInteractionCommands(
		buildKanbanOtherInputCommands({
			pendingQuestion,
			currentQuestionIndex,
			value,
			isOtherActive: selectionStore.isOtherActive(questionId, currentQuestionIndex),
		})
	);
}

function handleOtherKeydown(sessionId: string, currentQuestionIndex: number, key: string) {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const pendingQuestion = item.state.pendingInput.request;
	const questionId = resolveQuestionId(pendingQuestion);
	const otherValue = selectionStore.getOtherText(questionId, currentQuestionIndex).trim();
	applyQuestionInteractionCommands(
		buildKanbanOtherKeydownCommands({
			sessionId,
			pendingQuestion,
			currentQuestionIndex,
			key,
			otherValue,
		})
	);
}

function handlePrevQuestion(sessionId: string, currentQuestionIndex: number): void {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	applyQuestionInteractionCommands(
		buildKanbanQuestionNavigationCommands({
			sessionId,
			pendingQuestion: item.state.pendingInput.request,
			currentQuestionIndex,
			direction: "previous",
			totalQuestions: item.state.pendingInput.request.questions.length,
		})
	);
}

function handleNextQuestion(
	sessionId: string,
	currentQuestionIndex: number,
	totalQuestions: number
): void {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	applyQuestionInteractionCommands(
		buildKanbanQuestionNavigationCommands({
			sessionId,
			pendingQuestion: item.state.pendingInput.request,
			currentQuestionIndex,
			direction: "next",
			totalQuestions,
		})
	);
}

function handleSubmitQuestion(sessionId: string) {
	const item = itemLookup.get(sessionId);
	if (!item || item.state.pendingInput.kind !== "question") return;
	const pendingQuestion = item.state.pendingInput.request;
	const questionId = resolveQuestionId(pendingQuestion);
	const payload = buildKanbanQuestionSubmitPayload({
		pendingQuestion,
		hasAnySelections: selectionStore.hasAnySelections(questionId),
		getAnswers: (questionIndex, multiSelect) =>
			selectionStore.getAnswers(questionId, questionIndex, multiSelect),
	});
	if (!payload) return;
	selectionStore.clearQuestion(payload.questionId);
	questionIndexBySession.delete(sessionId);
	questionStore.reply(payload.requestId, payload.answers, payload.questions);
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
	<DialogFrame
		bind:open={newSessionOpen}
		title="New session"
		closeLabel="Close new session dialog"
		size="medium"
		hideHeader={true}
		portalDisabled={true}
		bind:contentRef={newSessionDialogRef}
		contentClass="overflow-hidden max-w-[34rem] rounded-2xl !border-0 bg-background p-0 shadow-xl !backdrop-blur-none"
		onOpenChange={handleNewSessionOpenChange}
		onOpenAutoFocus={(e: Event) => {
			e.preventDefault();
			requestAnimationFrame(() => {
				newSessionDialogRef?.querySelector<HTMLElement>("[contenteditable]")?.focus();
			});
		}}
	>
		<div class="flex w-full flex-col px-2 py-2 [&_[contenteditable=true]]:min-h-[7.2rem]">
				{#if canShowNewSessionInput}
					{#key newSessionComposerKey}
						<AgentInput
							panelId={KANBAN_NEW_SESSION_PANEL_ID}
							projectPath={selectedProject ? selectedProject.path : undefined}
							projectName={selectedProject ? selectedProject.name : undefined}
							selectedAgentId={effectiveAgentId}
							initialModeId={newSessionInitialModeId}
							voiceSessionId={KANBAN_NEW_SESSION_PANEL_ID}
							disableSend={!canSendFromNewSession}
							{availableAgents}
							onAgentChange={handleNewSessionAgentChange}
							onSessionCreated={handleNewSessionCreated}
							onWillSend={handleNewSessionWillSend}
							onSendError={handleNewSessionSendError}
							worktreePath={activeWorktreePath ? activeWorktreePath : undefined}
							worktreePending={effectiveWorktreePending}
							{preparedWorktreeLaunch}
							onWorktreeCreated={(path) => {
								activeWorktreePath = path;
								worktreePending = false;
							}}
							onPreparedWorktreeLaunch={(launch) => {
								preparedWorktreeLaunch = launch;
							}}
						>
							{#snippet agentProjectPicker()}
								<AgentSelector
									{availableAgents}
									currentAgentId={effectiveAgentId}
									onAgentChange={handleNewSessionAgentChange}
								/>
								{#if showProjectPicker}
									<ProjectSelector
										selectedProject={selectedProject}
										recentProjects={projects}
										onProjectChange={handleNewSessionProjectChange}
										onBrowse={handleBrowseProject}
									/>
								{/if}
							{/snippet}
						</AgentInput>
					{/key}
					{#if selectedProject}
						<div class="mt-2 flex h-7 items-center">
							<PreSessionWorktreeCard
								variant="trigger"
								menuSide="top"
								pendingWorktreeEnabled={effectiveWorktreePending}
								onYes={() => {
									preparedWorktreeLaunch = null;
									worktreePending = true;
								}}
								onNo={() => {
									preparedWorktreeLaunch = null;
									worktreePending = false;
								}}
								onDismiss={() => {
									preparedWorktreeLaunch = null;
									worktreePending = false;
								}}
							/>
						</div>
					{/if}
				{:else}
					<div class="rounded border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
						Add at least one project and one available agent to start a session.
					</div>
				{/if}
		</div>
	</DialogFrame>

	<div class="min-h-0 min-w-0 flex-1 overflow-hidden">
		{#each threadBoard as section (section.status)}
			{#each section.items as item (item.sessionId)}
				{#if item.linkedPr}
					{#key `${item.projectPath}:${item.linkedPr.prNumber}`}
						<PrChecksSurface
							projectPath={item.projectPath}
							prNumber={item.linkedPr.prNumber}
							surfaceId={`kanban:${item.sessionId}`}
						/>
					{/key}
				{/if}
			{/each}
		{/each}

		<KanbanSceneBoard
			model={sceneModel}
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
			onPrFooterOpen={handlePrFooterOpen}
			onPrFooterOpenExternal={handlePrFooterOpenExternal}
		>
			{#snippet columnHeaderActions(columnId)}
				{#if columnId === "planning"}
					<button
						type="button"
						class="flex size-4 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
						aria-label="New agent"
						data-testid="kanban-column-add-session-{columnId}"
						onclick={() => handleKanbanColumnCreate(CanonicalModeId.BUILD)}
					>
						<Plus class="size-3" weight="bold" />
					</button>
				{/if}
			{/snippet}
			{#snippet todoSectionRenderer(card: KanbanSceneCardData)}
				{@const item = itemLookup.get(card.id)}
				{#if item}
					<TodoHeader
						sessionId={item.sessionId}
						toolCalls={sessionStore.read.getSessionToolCalls(item.sessionId)}
						isConnected={item.state.connection === "connected"}
						status={item.sessionStatus}
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
		onFocusPanel={(panelId) => {
			appState.handleFocusPanel(panelId);
			acknowledgeExplicitPanelReveal(unseenStore, panelStore.getPanel(panelId));
		}}
		onToggleFullscreenPanel={(panelId) => {
			performExplicitPanelReveal(unseenStore, panelStore.getPanel(panelId), () => {
				appState.handleToggleFullscreen(panelId);
			});
		}}
		onDismiss={handleDialogDismiss}
		onClosePanel={handleDialogClosePanel}
	/>
</div>
