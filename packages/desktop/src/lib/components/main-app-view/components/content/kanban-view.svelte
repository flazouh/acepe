<script lang="ts">
	import IconDotsVertical from "@tabler/icons-svelte/icons/dots-vertical";
	import {
		AttentionQueueQuestionCard,
		CloseAction,
		Dialog,
		DialogContent,
		EmbeddedPanelHeader,
		HeaderActionCell,
		KanbanBoard,
		KanbanCard,
		type KanbanCardData,
		type KanbanColumnGroup,
		type KanbanTaskCardData,
		type KanbanToolData,
	} from "@acepe/ui";
	import * as DropdownMenu from "@acepe/ui/dropdown-menu";
	import { Colors } from "@acepe/ui/colors";
	import { SvelteMap } from "svelte/reactivity";
	import { onDestroy, onMount } from "svelte";
	import type { SessionStatus } from "$lib/acp/application/dto/session-status.js";
	import type { AgentInfo } from "$lib/acp/logic/agent-manager.js";
	import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
	import { getAgentIcon } from "$lib/acp/constants/thread-list-constants.js";
	import CopyButton from "$lib/acp/components/messages/copy-button.svelte";
	import { copySessionToClipboard, copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
	import { getOpenInFinderTarget } from "$lib/acp/components/agent-panel/logic/open-in-finder-target.js";
	import {
		getQueueItemTaskDisplay,
		getQueueItemToolDisplay,
	} from "$lib/acp/components/queue/queue-item-display.js";
	import PermissionActionBar from "$lib/acp/components/tool-calls/permission-action-bar.svelte";
	import TodoHeader from "$lib/acp/components/todo-header.svelte";
	import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
	import AgentSelector from "$lib/acp/components/agent-selector.svelte";
	import ProjectSelector from "$lib/acp/components/project-selector.svelte";
	import { WorktreeToggleControl } from "$lib/acp/components/worktree-toggle/index.js";
	import { getWorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
	import { loadWorktreeEnabled } from "$lib/acp/components/worktree-toggle/worktree-storage.js";
	import { toAgentToolKind } from "$lib/acp/components/tool-calls/tool-kind-to-agent-tool-kind.js";
	import { getToolCompactDisplayText } from "$lib/acp/registry/tool-kind-ui-registry.js";
	import { formatSessionTitleForDisplay } from "$lib/acp/store/session-title-policy.js";
	import {
		getAgentPreferencesStore,
		getAgentStore,
		getPanelStore,
		getPermissionStore,
		getQuestionStore,
		getSessionStore,
		getUnseenStore,
	} from "$lib/acp/store/index.js";
	import { getQuestionSelectionStore } from "$lib/acp/store/question-selection-store.svelte.js";
	import { buildQueueItemQuestionUiState } from "$lib/acp/components/queue/queue-item-question-ui-state.js";
	import { getPrimaryQuestionText, groupPendingQuestionsBySession } from "$lib/acp/store/question-selectors.js";
	import { buildQueueItem, calculateSessionUrgency, type QueueSessionSnapshot } from "$lib/acp/store/queue/utils.js";
	import { buildThreadBoard } from "$lib/acp/store/thread-board/build-thread-board.js";
	import type { ThreadBoardItem, ThreadBoardSource } from "$lib/acp/store/thread-board/thread-board-item.js";
	import type { ThreadBoardStatus } from "$lib/acp/store/thread-board/thread-board-status.js";
	import type { PermissionRequest } from "$lib/acp/types/permission.js";
	import type { QuestionRequest } from "$lib/acp/types/question.js";
	import { formatTimeAgo } from "$lib/acp/utils/time-utils.js";
	import { sessionEntriesToMarkdown } from "$lib/acp/utils/session-to-markdown.js";
	import { useTheme } from "$lib/components/theme/context.svelte.js";
	import { openFileInEditor, revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
	import { ResultAsync } from "neverthrow";
	import Robot from "phosphor-svelte/lib/Robot";
	import { toast } from "svelte-sonner";

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
	import { resolveKanbanNewSessionDefaults } from "./kanban-new-session-dialog-state.js";

	interface Props {
		projectManager: ProjectManager;
		state: MainAppViewState;
	}

	let { projectManager, state: appState }: Props = $props();

	const panelStore = getPanelStore();
	const sessionStore = getSessionStore();
	const agentStore = getAgentStore();
	const agentPreferencesStore = getAgentPreferencesStore();
	const permissionStore = getPermissionStore();
	const questionStore = getQuestionStore();
	const unseenStore = getUnseenStore();
	const selectionStore = getQuestionSelectionStore();
	const themeState = useTheme();
	const worktreeDefaultStore = getWorktreeDefaultStore();
	const isDev = import.meta.env.DEV;

	// Override CMD+T to open the kanban new-session dialog instead of spawning a panel
	onMount(() => {
		appState.onNewThreadOverride = () => handleNewSessionOpenChange(true);
	});
	onDestroy(() => {
		appState.onNewThreadOverride = null;
	});

	const KANBAN_NEW_SESSION_PANEL_ID = "kanban-new-session-dialog";

	let newSessionOpen = $state(false);
	let newSessionDialogRef = $state<HTMLElement | null>(null);
	let selectedProjectPath = $state<string | null>(null);
	let selectedAgentId = $state<string | null>(null);
	let activeWorktreePath = $state<string | null>(null);
	let worktreePending = $state(false);
	let activeDialogPanelId = $state<string | null>(null);
	let questionIndexBySession = $state(new SvelteMap<string, { questionId: string; currentQuestionIndex: number }>());

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

	const pendingQuestionsBySession = $derived.by(() =>
		groupPendingQuestionsBySession(questionStore.pending.values())
	);

	const pendingPermissionsBySession = $derived.by(() => {
		const permissionsBySession = new Map<
			string,
			typeof permissionStore.pending extends Map<string, infer Value> ? Value : never
		>();

		for (const permission of permissionStore.pending.values()) {
			if (!permissionsBySession.has(permission.sessionId)) {
				permissionsBySession.set(permission.sessionId, permission);
			}
		}

		return permissionsBySession;
	});

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
			const pendingQuestions = pendingQuestionsBySession.get(sessionId) ?? [];
			const pendingQuestion = pendingQuestions.length > 0 ? pendingQuestions[0] : null;
			const pendingPermission = pendingPermissionsBySession.get(sessionId) ?? null;
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
			});
		}

		return sources;
	});

	const threadBoard = $derived.by(() => buildThreadBoard(threadBoardSources));

	function mapItemToCard(item: ThreadBoardItem): KanbanCardData {
		const isWorking = item.state.activity.kind === "streaming" || item.state.activity.kind === "thinking";

		const toolDisplay = (() => {
			const currentToolDisplay = getQueueItemToolDisplay({
				activityKind: item.state.activity.kind,
				currentStreamingToolCall: item.currentStreamingToolCall,
				currentToolKind: item.currentToolKind,
				lastToolCall: null,
				lastToolKind: null,
			});

			if (!currentToolDisplay || currentToolDisplay.toolKind === "think") {
				return null;
			}

			return currentToolDisplay;
		})();

		const activityText: string | null = (() => {
			if (!isWorking) return null;
			if (toolDisplay) return null;
			return "Thinking…";
		})();

		const isStreaming = isWorking;
		const timeAgo = formatTimeAgo(item.lastActivityAt);
		const taskDisplay = getQueueItemTaskDisplay(
			toolDisplay ? toolDisplay.toolCall : null,
			toolDisplay ? toolDisplay.toolKind : null,
			toolDisplay ? toolDisplay.turnState : undefined,
		);
		const taskCard: KanbanTaskCardData | null = (() => {
			if (!taskDisplay.showTaskSubagentList || taskDisplay.taskSubagentTools.length === 0) {
				return null;
			}

			const summary = taskDisplay.taskDescription
				? taskDisplay.taskDescription
				: taskDisplay.taskSubagentSummaries[taskDisplay.taskSubagentSummaries.length - 1] ?? null;
			if (!summary) {
				return null;
			}

			return {
				summary,
				isStreaming,
				latestTool: taskDisplay.latestTaskSubagentTool,
				toolCalls: taskDisplay.taskSubagentTools,
			};
		})();

		const latestTool: KanbanToolData | null = (() => {
			if (taskCard) return null;
			if (!toolDisplay) return null;
			const tc = toolDisplay.toolCall;
			const displayTitle = getToolCompactDisplayText(
				toolDisplay.toolKind,
				tc,
				toolDisplay.turnState
			);
			const filePath =
				tc.locations && tc.locations.length > 0 && tc.locations[0]
					? tc.locations[0].path
					: undefined;
			const status = tc.status === "completed" ? "done" as const
				: tc.status === "failed" ? "error" as const
				: tc.status === "in_progress" ? "running" as const
				: "pending" as const;
			return {
				id: tc.id,
				kind: toAgentToolKind(toolDisplay.toolKind),
				title: displayTitle ? displayTitle : tc.name,
				filePath,
				status,
			};
		})();

		return {
			id: item.sessionId,
			title: getSessionDisplayName(item),
			agentIconSrc: getAgentIcon(item.agentId, themeState.effectiveTheme),
			agentLabel: item.agentId,
			projectName: item.projectName,
			projectColor: item.projectColor,
			timeAgo: timeAgo ? timeAgo : "",
			activityText,
			isStreaming,
			modeId: item.currentModeId,
			diffInsertions: item.insertions,
			diffDeletions: item.deletions,
			errorText: item.connectionError ? item.connectionError : item.state.connection === "error" ? "Connection error" : null,
			todoProgress: item.todoProgress
				? { current: item.todoProgress.current, total: item.todoProgress.total, label: item.todoProgress.label }
				: null,
			taskCard,
			latestTool,
			hasUnseenCompletion: item.state.attention.hasUnseenCompletion,
		};
	}

	function getPermissionRequest(item: ThreadBoardItem): PermissionRequest | null {
		if (item.state.pendingInput.kind !== "permission") return null;
		return item.state.pendingInput.request;
	}

	const groups = $derived.by((): readonly KanbanColumnGroup[] => {
		return SECTION_ORDER.map((sectionId) => {
			const section = threadBoard.find((group) => group.status === sectionId);
			return {
				id: sectionId,
				label: SECTION_LABELS[sectionId](),
				items: section ? section.items.map(mapItemToCard) : [],
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

	function handleCardClick(cardId: string) {
		const item = itemLookup.get(cardId);
		if (!item) return;
		if (item.projectPath) {
			panelStore.setFocusedViewProjectPath(item.projectPath);
		}
		panelStore.movePanelToFront(item.panelId);
		panelStore.focusPanel(item.panelId);
		activeDialogPanelId = item.panelId;
	}

	function handleCloseSession(item: ThreadBoardItem): void {
		if (activeDialogPanelId === item.panelId) {
			activeDialogPanelId = null;
		}

		panelStore.closePanel(item.panelId);
	}

	async function handleOpenInFinder(item: ThreadBoardItem): Promise<void> {
		const metadata = sessionStore.getSessionMetadata(item.sessionId);
		const target = getOpenInFinderTarget({
			sessionId: item.sessionId,
			projectPath: item.projectPath,
			agentId: item.agentId,
			sourcePath: metadata ? metadata.sourcePath : null,
		});

		if (!target) {
			toast.error(m.thread_open_in_finder_error_no_thread());
			return;
		}

		if (target.kind === "reveal") {
			await revealInFinder(target.path).match(
				() => undefined,
				() => toast.error(m.thread_open_in_finder_error())
			);
			return;
		}

		await tauriClient.shell.openInFinder(target.sessionId, target.projectPath).match(
			() => undefined,
			() => toast.error(m.thread_open_in_finder_error())
		);
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

	function resetNewSessionState(): void {
		const defaults = resolveKanbanNewSessionDefaults({
			projects,
			focusedProjectPath: panelStore.focusedViewProjectPath,
			availableAgents,
			selectedAgentIds: agentPreferencesStore.selectedAgentIds,
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
		newSessionOpen = nextOpen;
		if (!nextOpen) {
			return;
		}

		resetNewSessionState();
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

	function handleNewSessionWillSend(): void {
		if (!effectiveAgentId) {
			return;
		}

		persistSelectedAgent(effectiveAgentId);
	}

	function handleNewSessionCreated(sessionId: string): void {
		newSessionOpen = false;
		panelStore.openSession(sessionId, 450);
	}

	function resolveQuestionId(question: QuestionRequest): string {
		const callId = question.tool?.callID;
		return callId ? callId : question.id ? question.id : "";
	}

	function getQuestionUiState(item: ThreadBoardItem) {
		if (item.state.pendingInput.kind !== "question") return null;
		const pendingQuestion = item.state.pendingInput.request;
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
		selectionStore.setOtherText(questionId, 0, value);
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
		questionStore.reply(
			pendingQuestion.id,
			answers,
			pendingQuestion.questions
		);
	}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
	<Dialog bind:open={newSessionOpen} onOpenChange={handleNewSessionOpenChange}>
		<DialogContent
			bind:ref={newSessionDialogRef}
			showCloseButton={false}
			class="overflow-hidden max-w-[34rem] gap-0 border border-border/70 bg-background p-0 shadow-xl !backdrop-blur-none"
			portalProps={{ disabled: true }}
			onOpenAutoFocus={(e: Event) => {
				e.preventDefault();
				requestAnimationFrame(() => {
					newSessionDialogRef?.querySelector<HTMLElement>("[contenteditable]")?.focus();
				});
			}}
		>
			<EmbeddedPanelHeader>
				<div class="flex min-w-0 items-center gap-2 px-2 text-[11px] font-medium">
					<Robot weight="fill" class="h-3.5 w-3.5" style="color: {Colors.purple}" />
					<span class="truncate text-foreground">New Agent</span>
				</div>
				<div class="flex-1"></div>
				<HeaderActionCell class="ml-auto" withDivider={true}>
					{#snippet children()}
						<CloseAction onClose={() => handleNewSessionOpenChange(false)} />
					{/snippet}
				</HeaderActionCell>
			</EmbeddedPanelHeader>
			<div class="mx-auto flex w-full max-w-[30rem] flex-col px-3 pt-4 pb-2">
				<h1 class="mb-6 text-center font-sans text-[1.9rem] font-semibold tracking-tight text-foreground sm:text-4xl">
					What do you want to build?
				</h1>
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

	<div class="min-h-0 min-w-0 flex-1">
		<KanbanBoard {groups} emptyHint="No sessions">
			{#snippet cardRenderer(card: KanbanCardData)}
				{@const item = itemLookup.get(card.id)}
				{@const permission = item ? getPermissionRequest(item) : null}
				{@const currentQuestionIndex = item ? getCurrentQuestionIndex(item) : 0}
				{@const questionUiState = item ? getQuestionUiState(item) : null}
				{@const questionId = item ? getPendingQuestionId(item) : ""}
				{@const hotState = item ? sessionStore.getHotState(item.sessionId) : null}
				{@const showFooter = permission !== null || questionUiState !== null}
				{#if item}
					<KanbanCard {card} onclick={() => handleCardClick(card.id)} onClose={() => handleCloseSession(item)} showFooter={showFooter}>
						{#snippet todoSection()}
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
						{/snippet}
						{#snippet menu()}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="shrink-0 inline-flex h-5 w-5 items-center justify-center p-1 text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
									aria-label="More actions"
									title="More actions"
									onclick={(event: MouseEvent) => event.stopPropagation()}
								>
									<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end" class="min-w-[180px]">
									<DropdownMenu.Item class="cursor-pointer">
										<CopyButton
											text={item.sessionId}
											variant="menu"
											label={m.session_menu_copy_id()}
											hideIcon
											size={16}
										/>
									</DropdownMenu.Item>
									<DropdownMenu.Item class="cursor-pointer">
										<CopyButton
											getText={() => getSessionDisplayName(item)}
											variant="menu"
											label={m.session_menu_copy_title()}
											hideIcon
											size={16}
										/>
									</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => {
										void handleOpenRawFile(item);
									}} class="cursor-pointer">
										{m.session_menu_open_raw_file()}
									</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => {
										void handleOpenInAcepe(item);
									}} class="cursor-pointer">
										{m.session_menu_open_in_acepe()}
									</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => {
										void handleOpenInFinder(item);
									}} class="cursor-pointer">
										{m.thread_open_in_finder()}
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger class="cursor-pointer">
											{m.session_menu_export()}
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="min-w-[160px]">
											<DropdownMenu.Item onSelect={() => {
												void handleExportMarkdown(item);
											}} class="cursor-pointer">
												{m.session_menu_export_markdown()}
											</DropdownMenu.Item>
											<DropdownMenu.Item onSelect={() => {
												void handleExportJson(item);
											}} class="cursor-pointer">
												{m.session_menu_export_json()}
											</DropdownMenu.Item>
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>
									{#if isDev}
										<DropdownMenu.Separator />
										<DropdownMenu.Item onSelect={() => {
											void handleCopyStreamingLogPath(item);
										}} class="cursor-pointer">
											Copy Streaming Log Path
										</DropdownMenu.Item>
										<DropdownMenu.Item onSelect={() => {
											void handleExportRawStreaming(item);
										}} class="cursor-pointer">
											{m.thread_export_raw_streaming()}
										</DropdownMenu.Item>
									{/if}
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						{/snippet}
						{#snippet footer()}
							<div
								class="flex min-w-0 flex-col gap-1"
								data-has-permission={permission ? "true" : "false"}
								data-has-question={questionUiState ? "true" : "false"}
							>
								{#if permission}
									<PermissionActionBar permission={permission} compact hideHeader projectPath={item.projectPath} />
								{:else if questionUiState && questionUiState.currentQuestion}
									<AttentionQueueQuestionCard
										currentQuestion={questionUiState.currentQuestion}
										totalQuestions={questionUiState.totalQuestions}
										hasMultipleQuestions={questionUiState.hasMultipleQuestions}
										{currentQuestionIndex}
										{questionId}
										questionProgress={questionUiState.questionProgress}
										currentQuestionAnswered={questionUiState.currentQuestionAnswered}
										currentQuestionOptions={questionUiState.currentQuestionOptions}
										otherText={questionUiState.otherText}
										otherPlaceholder={m.question_other_placeholder()}
										showOtherInput={questionUiState.showOtherInput}
										showSubmitButton={questionUiState.showSubmitButton}
										canSubmit={questionUiState.canSubmit}
										submitLabel={m.common_submit()}
										onOptionSelect={(optionLabel: string) => handleOptionSelect(card.id, currentQuestionIndex, optionLabel)}
										onOtherInput={(value: string) => handleOtherInput(card.id, currentQuestionIndex, value)}
										onOtherKeydown={(key: string) => handleOtherKeydown(card.id, currentQuestionIndex, key)}
										onSubmitAll={() => handleSubmitQuestion(card.id)}
										onPrevQuestion={() => handlePrevQuestion(card.id, currentQuestionIndex)}
										onNextQuestion={() => handleNextQuestion(card.id, currentQuestionIndex, questionUiState.totalQuestions)}
									/>
								{/if}
							</div>
						{/snippet}
					</KanbanCard>
				{:else}
					<KanbanCard {card} onclick={() => handleCardClick(card.id)} />
				{/if}
			{/snippet}
		</KanbanBoard>
	</div>

	<KanbanThreadDialog
		panelId={activeDialogPanelId}
		{projectManager}
		state={appState}
		onClose={() => (activeDialogPanelId = null)}
	/>
</div>
