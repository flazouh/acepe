<script lang="ts">
	import IconArrowUp from "@tabler/icons-svelte/icons/arrow-up";
	import IconDotsVertical from "@tabler/icons-svelte/icons/dots-vertical";
	import {
		Button,
		CloseAction,
		Dialog,
		DialogContent,
		EmbeddedPanelHeader,
		HeaderActionCell,
		KanbanBoard,
		KanbanCard,
		KanbanCompactComposer,
		KanbanQuestionFooter,
		type KanbanCardData,
		type KanbanColumnGroup,
		type KanbanQuestionData,
		type KanbanTaskCardData,
		type KanbanToolData,
	} from "@acepe/ui";
	import * as DropdownMenu from "@acepe/ui/dropdown-menu";
	import { Colors } from "@acepe/ui/colors";
	import { onDestroy } from "svelte";
	import type { SessionStatus } from "$lib/acp/application/dto/session-status.js";
	import type { SessionEntry } from "$lib/acp/application/dto/session-entry.js";
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
	import MicButton from "$lib/acp/components/agent-input/components/mic-button.svelte";
	import { VoiceInputState } from "$lib/acp/components/agent-input/state/voice-input-state.svelte.js";
	import { shouldStartVoiceHold, shouldStopVoiceHold } from "$lib/acp/components/agent-input/logic/voice-keyboard.js";
	import { canStartVoiceInteraction } from "$lib/acp/components/agent-input/logic/voice-ui-state.js";
	import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
	import ModelSelectorMetricsChip from "$lib/acp/components/model-selector.metrics-chip.svelte";
	import { hasVisibleModelSelectorMetrics } from "$lib/acp/components/model-selector.metrics-chip.logic.js";
	import AgentSelector from "$lib/acp/components/agent-selector.svelte";
	import ProjectSelector from "$lib/acp/components/project-selector.svelte";
	import { WorktreeToggleControl } from "$lib/acp/components/worktree-toggle/index.js";
	import { getWorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
	import { loadWorktreeEnabled } from "$lib/acp/components/worktree-toggle/worktree-storage.js";
	import { getToolCompactDisplayText } from "$lib/acp/registry/tool-kind-ui-registry.js";
	import { normalizeTitleForDisplay } from "$lib/acp/store/session-title-policy.js";
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
	import { getPrimaryQuestionText, groupPendingQuestionsBySession } from "$lib/acp/store/question-selectors.js";
	import { buildQueueItem, calculateSessionUrgency, type QueueSessionSnapshot } from "$lib/acp/store/queue/utils.js";
	import { buildThreadBoard } from "$lib/acp/store/thread-board/build-thread-board.js";
	import type { ThreadBoardItem, ThreadBoardSource } from "$lib/acp/store/thread-board/thread-board-item.js";
	import type { ThreadBoardStatus } from "$lib/acp/store/thread-board/thread-board-status.js";
	import type { PermissionRequest } from "$lib/acp/types/permission.js";
	import type { QuestionRequest } from "$lib/acp/types/question.js";
	import { AGENT_IDS } from "$lib/acp/types/agent-id.js";
	import { formatTimeAgo } from "$lib/acp/utils/time-utils.js";
	import { sessionEntriesToMarkdown } from "$lib/acp/utils/session-to-markdown.js";
	import { useTheme } from "$lib/components/theme/context.svelte.js";
	import { getVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";
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
	const voiceSettingsStore = getVoiceSettingsStore();
	const voiceEnabled = $derived(voiceSettingsStore.enabled);
	const isDev = import.meta.env.DEV;

	const KANBAN_NEW_SESSION_PANEL_ID = "kanban-new-session-dialog";

	const cardDrafts = new Map<string, string>();
	const cardVoiceStates = new Map<string, VoiceInputState>();

	function getOrCreateVoiceState(sessionId: string): VoiceInputState {
		const existing = cardVoiceStates.get(sessionId);
		if (existing) return existing;

		const state = new VoiceInputState({
			sessionId,
			getSelectedLanguage: () => voiceSettingsStore.language,
			getSelectedModelId: () => voiceSettingsStore.selectedModelId,
			onTranscriptionReady: (text) => {
				const normalizedText = text.replace(/\s+/g, " ").trim();
				if (!normalizedText) return;
				const current = cardDrafts.get(sessionId);
				const sep = current && current.length > 0 ? " " : "";
				const next = (current ? current : "") + sep + normalizedText;
				cardDrafts.set(sessionId, next);
			},
		});
		void state.registerListeners();
		cardVoiceStates.set(sessionId, state);
		return state;
	}

	onDestroy(() => {
		for (const vs of cardVoiceStates.values()) {
			vs.dispose();
		}
		cardVoiceStates.clear();
	});

	function handleComposerKeydown(sessionId: string, event: KeyboardEvent): void {
		if (!voiceEnabled) return;
		if (!shouldStartVoiceHold(event)) return;
		const vs = getOrCreateVoiceState(sessionId);
		if (!canStartVoiceInteraction(vs.phase, false)) return;
		event.preventDefault();
		vs.onKeyboardHoldStart();
	}

	function handleComposerKeyup(sessionId: string, event: KeyboardEvent): void {
		const vs = cardVoiceStates.get(sessionId);
		if (!vs) return;
		if (!shouldStopVoiceHold(event, vs.isPressAndHold)) return;
		vs.onKeyboardHoldEnd();
	}

	let newSessionOpen = $state(false);
	let selectedProjectPath = $state<string | null>(null);
	let selectedAgentId = $state<string | null>(null);
	let activeWorktreePath = $state<string | null>(null);
	let worktreePending = $state(false);
	let activeDialogPanelId = $state<string | null>(null);

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
		finished: () => m.queue_group_finished(),
		idle: () => "Idle",
		error: () => m.queue_group_error(),
	};

	const SECTION_ORDER: readonly ThreadBoardStatus[] = [
		"answer_needed",
		"planning",
		"working",
		"finished",
		"idle",
	];

	// NOTE: SECTION_LABELS is also defined in queue-section.svelte. Both are
	// thin i18n wrappers that cannot be extracted without coupling the store
	// layer to Paraglide runtime. Duplication is acceptable here.

	function getKanbanPreviewMarkdown(entries: readonly SessionEntry[]): string | null {
		const parts: string[] = [];

		for (const entry of entries) {
			if (entry.type === "user") {
				const text = entry.message.content.type === "text" ? entry.message.content.text.trim() : "";
				if (text.length > 0) {
					parts.push(`**You:** ${text}`);
				}
			} else if (entry.type === "assistant") {
				const text = entry.message.chunks
					.flatMap((chunk) =>
						chunk.type === "message" && chunk.block.type === "text" ? [chunk.block.text] : []
					)
					.join("")
					.trim();
				if (text.length > 0) {
					parts.push(text);
				}
			}
		}

		return parts.length > 0 ? parts.join("\n\n---\n\n") : null;
	}

	function capitalizeTitle(text: string): string {
		return text
			.split(/\s+/)
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
	}

	function getSessionDisplayName(item: ThreadBoardItem): string {
		const cleanedTitle = normalizeTitleForDisplay(item.title ? item.title : "");

		if (cleanedTitle !== "") {
			return capitalizeTitle(cleanedTitle);
		}

		if (item.projectName && item.projectName !== "Unknown") {
			return capitalizeTitle(`Conversation in ${item.projectName}`);
		}

		return "Untitled conversation";
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
		const showHistoricalActivity = item.status !== "idle";

		const toolDisplay = getQueueItemToolDisplay({
			activityKind: item.state.activity.kind,
			currentStreamingToolCall: item.currentStreamingToolCall,
			currentToolKind: item.currentToolKind,
			lastToolCall: item.lastToolCall,
			lastToolKind: item.lastToolKind,
		});

		const activityText: string | null = (() => {
			if (!showHistoricalActivity) return null;
			if (item.state.activity.kind === "thinking") return "Thinking…";
			if (toolDisplay) {
				return getToolCompactDisplayText(
					toolDisplay.toolKind,
					toolDisplay.toolCall,
					toolDisplay.turnState
				);
			}
			return null;
		})();

		const isStreaming =
			item.state.activity.kind === "streaming" || item.state.activity.kind === "thinking";
		const normalizedTitle = normalizeTitleForDisplay(item.title ? item.title : "");
		const timeAgo = formatTimeAgo(item.lastActivityAt);
		const previewMarkdown = getKanbanPreviewMarkdown(sessionStore.getEntries(item.sessionId));
		const taskDisplay = getQueueItemTaskDisplay(
			toolDisplay ? toolDisplay.toolCall : null,
			toolDisplay ? toolDisplay.toolKind : null,
			toolDisplay ? toolDisplay.turnState : undefined,
		);
		const taskCard: KanbanTaskCardData | null = (() => {
			if (!showHistoricalActivity) return null;
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
			if (!showHistoricalActivity) return null;
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
				kind: toolDisplay.toolKind ? toolDisplay.toolKind : undefined,
				title: displayTitle ? displayTitle : tc.name,
				filePath,
				status,
			};
		})();

		return {
			id: item.sessionId,
			title: normalizedTitle ? normalizedTitle : null,
			agentIconSrc: getAgentIcon(item.agentId, themeState.effectiveTheme),
			agentLabel: item.agentId,
			projectName: item.projectName,
			projectColor: item.projectColor,
			timeAgo: timeAgo ? timeAgo : "",
			previewMarkdown,
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
			toolCalls: [],
		};
	}

	function getPermissionRequest(item: ThreadBoardItem): PermissionRequest | null {
		if (item.state.pendingInput.kind !== "permission") return null;
		return item.state.pendingInput.request;
	}

	function getQuestionData(item: ThreadBoardItem): KanbanQuestionData | null {
		if (item.state.pendingInput.kind !== "question") return null;
		const pendingQuestion = item.state.pendingInput.request;
		const q = pendingQuestion.questions[0];
		if (!q) return null;
		const callId = pendingQuestion.tool?.callID;
		const questionId = callId ? callId : pendingQuestion.id ? pendingQuestion.id : "";
		const rawOptions = q.options;
		const options = (rawOptions ? rawOptions : []).map((opt) => ({
			label: opt.label,
			selected: selectionStore.isOptionSelected(questionId, 0, opt.label),
		}));
		const hasSelections = selectionStore.hasSelections(questionId, 0);
		return {
			questionText: q.question,
			options,
			canSubmit: hasSelections,
		};
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

	function handleSelectOption(sessionId: string, optionIndex: number) {
		const item = itemLookup.get(sessionId);
		if (!item || item.state.pendingInput.kind !== "question") return;
		const pendingQuestion = item.state.pendingInput.request;
		const q = pendingQuestion.questions[0];
		if (!q) return;
		const opts = q.options;
		const opt = opts ? opts[optionIndex] : undefined;
		if (!opt) return;
		const questionId = resolveQuestionId(pendingQuestion);
		if (q.multiSelect) {
			selectionStore.toggleOption(questionId, 0, opt.label);
			return;
		}
		selectionStore.setSingleOption(questionId, 0, opt.label);
	}

	function isComposerVisible(item: ThreadBoardItem): boolean {
		return (
			item.state.connection === "connected" &&
			item.state.activity.kind === "idle" &&
			item.state.pendingInput.kind === "none"
		);
	}

	function getComposerModeLabel(item: ThreadBoardItem): string {
		return item.currentModeId ? item.currentModeId : "code";
	}

	function handleComposerInput(sessionId: string, value: string): void {
		cardDrafts.set(sessionId, value);
	}

	function handleComposerSubmit(sessionId: string): void {
		const draft = cardDrafts.get(sessionId);
		if (!draft || draft.trim().length === 0) return;
		cardDrafts.delete(sessionId);
		void sessionStore.sendMessage(sessionId, draft.trim());
	}

	function handleSubmitQuestion(sessionId: string) {
		const item = itemLookup.get(sessionId);
		if (!item || item.state.pendingInput.kind !== "question") return;
		const pendingQuestion = item.state.pendingInput.request;
		const q = pendingQuestion.questions[0];
		if (!q) return;
		const questionId = resolveQuestionId(pendingQuestion);
		const answers = selectionStore.getAnswers(questionId, 0, q.multiSelect);
		if (answers.length === 0) return;
		questionStore.reply(
			pendingQuestion.id,
			[{ questionIndex: 0, answers }],
			pendingQuestion.questions
		);
	}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
	<div class="flex shrink-0 items-center justify-end px-2 pt-2">
		<Button
			variant="outline"
			size="header"
			class="gap-2"
			onclick={() => handleNewSessionOpenChange(true)}
			disabled={createDisabled}
		>
			<Robot weight="fill" class="h-3.5 w-3.5" style="color: {Colors.purple}" />
			<span>New Agent</span>
		</Button>
	</div>

	<Dialog bind:open={newSessionOpen} onOpenChange={handleNewSessionOpenChange}>
		<DialogContent
			showCloseButton={false}
			class="overflow-hidden max-w-[34rem] gap-0 border border-border/70 bg-background p-0 shadow-xl !backdrop-blur-none"
			portalProps={{ disabled: true }}
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
				{@const question = item ? getQuestionData(item) : null}
				{@const usageTelemetry = item ? (sessionStore.getHotState(item.sessionId).usageTelemetry ?? null) : null}
				{@const isClaudeCode = item ? item.agentId === AGENT_IDS.CLAUDE_CODE : false}
				{@const showUsage = hasVisibleModelSelectorMetrics(usageTelemetry, isClaudeCode)}
				{@const showComposer = item ? isComposerVisible(item) : false}
				{@const showFooter = permission !== null || question !== null || showUsage || showComposer}
				{#if item}
					<KanbanCard {card} onclick={() => handleCardClick(card.id)} showFooter={showFooter} flushFooter={showComposer}>
						{#snippet menu()}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="shrink-0 inline-flex h-3 w-2.5 items-center justify-center text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
									aria-label="More actions"
									title="More actions"
									onclick={(event) => event.stopPropagation()}
								>
									<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end" class="min-w-[180px]">
									<DropdownMenu.Item onSelect={() => handleCloseSession(item)} class="cursor-pointer">
										{m.common_close()}
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
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
								data-show-usage={showUsage ? "true" : "false"}
								data-has-permission={permission ? "true" : "false"}
								data-has-question={question ? "true" : "false"}
								data-is-claude-code={isClaudeCode ? "true" : "false"}
								data-show-composer={showComposer ? "true" : "false"}
							>
								{#if showComposer}
									<KanbanCompactComposer
										modeLabel={item ? getComposerModeLabel(item) : "code"}
										value={cardDrafts.get(card.id) ? cardDrafts.get(card.id)! : ""}
										canSubmit={(cardDrafts.get(card.id) ? cardDrafts.get(card.id)! : "").trim().length > 0}
										onInput={(v) => handleComposerInput(card.id, v)}
										onSubmit={() => handleComposerSubmit(card.id)}
									/>
								{/if}
								{#if showUsage}
									<ModelSelectorMetricsChip sessionId={card.id} agentId={item.agentId} compact={true} hideLabel={true} />
								{/if}
								{#if permission}
									<PermissionActionBar permission={permission} compact projectPath={item.projectPath} />
								{:else if question}
									<KanbanQuestionFooter
										question={question}
										onSelectOption={(i: number) => handleSelectOption(card.id, i)}
										onSubmit={() => handleSubmitQuestion(card.id)}
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