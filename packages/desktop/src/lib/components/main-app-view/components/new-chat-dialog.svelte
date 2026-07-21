<!--
  NewChatDialog — the app-wide "new chat" modal (the new-session composer dialog).

  Extracted from kanban-view so it can be mounted once at the app shell and opened
  from global new-thread entry points (sidebar "New chat", ⌘N/⌘T, kanban columns)
  via `appState.onNewThreadOverride`. Per-project "+" spawns a panel directly.
  Self-contained: owns its composer state and creates sessions through panelStore.

  The composer renders the standard new-thread SETUP BAR (project / agent / branch /
  worktree chips) via AgentInput's `newThreadContext`, so it matches the empty-panel
  setup experience — no separate in-composer picker, no bottom worktree widget.
-->
<script lang="ts">
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
import AgentSelector from "$lib/acp/components/agent-selector.svelte";
import ProjectSelector from "$lib/acp/components/project-selector.svelte";
import BranchPicker from "$lib/acp/components/branch-picker/branch-picker.svelte";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { PreparedWorktreeLaunch } from "$lib/acp/types/worktree-info.js";
import { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";
import { getAgentPreferencesStore, getAgentStore, getPanelStore } from "$lib/acp/store/index.js";
import { getWorktreeProjectDefaultStore } from "$lib/acp/components/worktree/worktree-project-default-store.svelte.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { toast } from "svelte-sonner";
import {
	canSendWithoutSession,
	resolveEmptyStateAgentId,
} from "./content/logic/empty-state-send-state.js";
import { buildNewChatAgentSelectorModel } from "./new-chat-agent-selector-model.js";
import {
	buildKanbanNewSessionProjectChangeState,
	buildKanbanNewSessionResetState,
	resolveKanbanNewSessionOpenChangeAction,
	type KanbanNewSessionRequest,
} from "./content/kanban-new-session-dialog-state.js";
import { KANBAN_SESSION_PANEL_WIDTH } from "./content/kanban-session-panel-width.js";
import { completeKanbanNewSessionHandoff } from "./content/logic/kanban-new-session-handoff.js";
import { ensureSpawnableAgentSelected } from "../logic/spawnable-agents.js";

interface Props {
	projectManager: ProjectManager;
}

let { projectManager }: Props = $props();

const NEW_CHAT_DIALOG_PANEL_ID = "kanban-new-session-dialog";

const panelStore = getPanelStore();
const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const worktreeProjectDefaultStore = getWorktreeProjectDefaultStore();

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
let preSessionCurrentBranch = $state<string | null>(null);
let preSessionIsGitRepo = $state<boolean | null>(null);

const isProjectWorktreeEnabled = (path: string) => worktreeProjectDefaultStore.isEnabled(path);
const projects = $derived(projectManager.projects);
const selectedProject = $derived.by((): Project | null => {
	if (!selectedProjectPath) {
		return null;
	}
	return projectManager.getProject(selectedProjectPath) ?? null;
});
const agentSelectorModel = $derived.by(() =>
	buildNewChatAgentSelectorModel({
		agents: agentStore.agents,
		selectedAgentIds: agentPreferencesStore.selectedAgentIds,
		selectedProjectPath: selectedProject?.path ?? null,
	})
);
const availableAgents = $derived(agentSelectorModel.availableAgents);
const availableAgentIds = $derived(availableAgents.map((agent) => agent.id));
const effectiveAgentId = $derived(
	resolveEmptyStateAgentId({
		selectedAgentId,
		defaultAgentId: agentPreferencesStore.defaultAgentId,
		availableAgentIds,
	})
);
const canShowNewSessionInput = $derived(projects.length > 0 && availableAgents.length > 0);
const effectiveWorktreePending = $derived(worktreePending && activeWorktreePath === null);
const canSendFromNewSession = $derived(
	canSendWithoutSession({
		projectPath: selectedProject ? selectedProject.path : null,
		selectedAgentId: effectiveAgentId,
	})
);

/** Load current branch + git-repo status for the setup bar's branch chip. */
function loadBranchForProject(projectPath: string | null): void {
	preSessionCurrentBranch = null;
	preSessionIsGitRepo = null;
	if (!projectPath) {
		return;
	}
	void tauriClient.git.isRepo(projectPath).match(
		(isRepo) => {
			preSessionIsGitRepo = isRepo;
		},
		() => {
			preSessionIsGitRepo = null;
		}
	);
	void tauriClient.git.currentBranch(projectPath).match(
		(branch) => {
			preSessionCurrentBranch = branch ?? null;
		},
		() => {
			preSessionCurrentBranch = null;
		}
	);
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
		isProjectWorktreeEnabled,
	});

	selectedProjectPath = nextState.selectedProjectPath;
	selectedAgentId = nextState.selectedAgentId;
	newSessionInitialModeId = nextState.initialModeId;
	newSessionComposerKey = nextState.composerKey;
	activeWorktreePath = nextState.activeWorktreePath;
	preparedWorktreeLaunch = nextState.preparedWorktreeLaunch;
	worktreePending = nextState.worktreePending;
	loadBranchForProject(nextState.selectedProjectPath);
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

/** Public entry point: open the dialog, optionally seeded with a request (project/agent/mode). */
export function open(request?: KanbanNewSessionRequest): void {
	pendingNewSessionRequest = request ? request : null;
	handleNewSessionOpenChange(true);
}

function handleNewSessionAgentChange(agentId: string): void {
	selectedAgentId = agentId;
}

function handleNewSessionProjectChange(project: Project): void {
	const nextState = buildKanbanNewSessionProjectChangeState({
		projectPath: project.path,
		isProjectWorktreeEnabled,
	});
	selectedProjectPath = nextState.selectedProjectPath;
	activeWorktreePath = nextState.activeWorktreePath;
	preparedWorktreeLaunch = nextState.preparedWorktreeLaunch;
	worktreePending = nextState.worktreePending;
	loadBranchForProject(nextState.selectedProjectPath);
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
		panelStore.setPendingComposerRestore(NEW_CHAT_DIALOG_PANEL_ID, restore);
		panelStore.setMessageDraft(NEW_CHAT_DIALOG_PANEL_ID, restore.draft);
	}

	panelStore.closePanel(panelId);
	newSessionOpen = true;
}
</script>

{#snippet newThreadProjectControl()}
	<ProjectSelector
		selectedProject={selectedProject}
		recentProjects={projects}
		onProjectChange={handleNewSessionProjectChange}
		onBrowse={handleBrowseProject}
		showLabel
	/>
{/snippet}

{#snippet newThreadAgentControl()}
	<AgentSelector
		{availableAgents}
		currentAgentId={effectiveAgentId}
		projectPath={agentSelectorModel.projectPath}
		onAgentChange={handleNewSessionAgentChange}
		showLabel
	/>
{/snippet}

{#snippet newThreadBranchControl()}
	{#if selectedProject}
		<BranchPicker
			projectPath={selectedProject.path}
			currentBranch={preSessionCurrentBranch}
			diffStats={null}
			isGitRepo={preSessionIsGitRepo}
			variant="setupBarChip"
			onBranchSelected={(branch) => {
				preSessionCurrentBranch = branch;
			}}
			onInitGitRepo={() => {
				const projectPath = selectedProject ? selectedProject.path : null;
				if (!projectPath) {
					return;
				}
				void tauriClient.git.init(projectPath).match(
					() => loadBranchForProject(projectPath),
					(error) => {
						toast.error(error.cause?.message ?? error.message ?? "Failed to initialize git");
					}
				);
			}}
		/>
	{/if}
{/snippet}

<DialogFrame
	bind:open={newSessionOpen}
	title="New chat"
	closeLabel="Close new chat dialog"
	size="medium"
	hideHeader={true}
	bind:contentRef={newSessionDialogRef}
	contentClass="mx-auto w-full overflow-hidden max-w-[34rem] rounded-lg !border-0 bg-background p-0 shadow-xl !backdrop-blur-none"
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
					panelId={NEW_CHAT_DIALOG_PANEL_ID}
					projectPath={selectedProject ? selectedProject.path : undefined}
					projectName={selectedProject ? selectedProject.name : undefined}
					selectedAgentId={effectiveAgentId}
					initialModeId={newSessionInitialModeId}
					voiceSessionId={NEW_CHAT_DIALOG_PANEL_ID}
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
					newThreadContext={{
						project: newThreadProjectControl,
						agent: newThreadAgentControl,
						branch: newThreadBranchControl,
						showWorktree: selectedProject !== null,
						worktreeOn: worktreePending,
						worktreeDisabled: false,
						onWorktreeToggle: (on) => {
							preparedWorktreeLaunch = null;
							worktreePending = on;
							if (selectedProjectPath) {
								void worktreeProjectDefaultStore.set(selectedProjectPath, on);
							}
						},
						setupBarAlign: "start",
					}}
				/>
			{/key}
		{:else}
			<div
				class="rounded border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-sm text-muted-foreground"
			>
				Add at least one project and one available agent to start a session.
			</div>
		{/if}
	</div>
</DialogFrame>
