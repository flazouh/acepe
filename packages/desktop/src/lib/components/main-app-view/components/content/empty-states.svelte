<script lang="ts">
import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
import AgentSelector from "$lib/acp/components/agent-selector.svelte";
import ProjectSelector from "$lib/acp/components/project-selector.svelte";
import { WorktreeToggleControl } from "$lib/acp/components/worktree-toggle/index.js";
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
import { loadWorktreeEnabled } from "$lib/acp/components/worktree-toggle/worktree-storage.js";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getPanelStore } from "$lib/acp/store/panel-store.svelte.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import * as m from "$lib/paraglide/messages.js";
import { toast } from "svelte-sonner";

import {
	attachSessionToEmptyStatePanel,
	ensureEmptyStatePanelContext,
} from "./logic/empty-state-panel-context.js";
import {
	ensureSpawnableAgentSelected,
	getSpawnableSessionAgents,
} from "../../logic/spawnable-agents.js";
import {
	canSendWithoutSession,
	EMPTY_STATE_PANEL_ID,
	resolveEmptyStateAgentId,
	resolveEmptyStateWorktreePending,
	resolveEmptyStateWorktreePendingForProjectChange,
} from "./logic/empty-state-send-state.js";

interface Props {
	projectManager: ProjectManager;
	onSessionCreated: (id: string) => void;
}

const { projectManager, onSessionCreated }: Props = $props();

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const panelStore = getPanelStore();
const logger = createLogger({ id: "empty-state-worktree", name: "EmptyStateWorktree" });

// Global worktree default (loaded once at app root in main-app-view, read reactively here)
const worktreeDefaultStore = getWorktreeDefaultStore();
const globalWorktreeDefault = $derived(worktreeDefaultStore.globalDefault);

// Local state — only written by explicit user actions
let selectedAgentId: string | null = $state(null);
let selectedProject: Project | null = $state(null);
let activeWorktreePath: string | null = $state(null);
let worktreePending = $state(false);

// Derived
const availableAgents = $derived(
	getSpawnableSessionAgents(agentStore.agents, agentPreferencesStore.selectedAgentIds)
);
const projects = $derived(projectManager.projects);
const availableAgentIds = $derived(availableAgents.map((agent) => agent.id));

// Resolve effective agent: explicit selection if still available, otherwise first available
const effectiveAgentId = $derived(
	resolveEmptyStateAgentId({
		selectedAgentId,
		availableAgentIds,
	})
);

// Resolve effective project: user selection, then auto-select for single/multi
const effectiveProject = $derived(
	selectedProject ?? (projects.length >= 1 ? projects[0] : null) ?? null
);
const projectPath = $derived(effectiveProject?.path ?? null);
const projectName = $derived(effectiveProject?.name ?? null);

const showProjectPicker = $derived(projects.length > 1);
const canShowInput = $derived(projects.length > 0 && availableAgents.length > 0);
const effectiveWorktreePending = $derived(worktreePending && activeWorktreePath === null);
const canSendFromEmptyState = $derived(
	canSendWithoutSession({
		projectPath,
		selectedAgentId: effectiveAgentId,
	})
);

$effect(() => {
	const currentProjectPath = projectPath;
	if (currentProjectPath === null) {
		worktreePending = false;
		return;
	}

	if (activeWorktreePath !== null) {
		return;
	}
	worktreePending = resolveEmptyStateWorktreePending({
		activeWorktreePath,
		globalWorktreeDefault,
		loadEnabled: loadWorktreeEnabled,
	});
});

function handleAgentChange(agentId: string) {
	selectedAgentId = agentId;
}

function handleProjectChange(project: Project) {
	logger.info("[worktree-debug] empty-state project change", {
		projectPath: project.path,
		previousProjectPath: projectPath,
		activeWorktreePath,
		worktreePendingBefore: worktreePending,
		globalWorktreeDefault,
	});
	selectedProject = project;
	activeWorktreePath = null;
	worktreePending = resolveEmptyStateWorktreePendingForProjectChange({
		globalWorktreeDefault,
		loadEnabled: loadWorktreeEnabled,
	});
	logger.info("[worktree-debug] empty-state project change resolved", {
		projectPath: project.path,
		activeWorktreePath,
		worktreePendingAfter: worktreePending,
	});
}

function handleBrowseProject() {
	projectManager.importProject();
}

function persistSelectedAgent(agentId: string) {
	const agentIsSelected = agentPreferencesStore.selectedAgentIds.includes(agentId);
	if (agentIsSelected) {
		return;
	}

	const nextSelectedAgentIds = ensureSpawnableAgentSelected(
		agentPreferencesStore.selectedAgentIds,
		agentId
	);

	void agentPreferencesStore.setSelectedAgentIds(nextSelectedAgentIds).match(
		() => undefined,
		(error) => {
			toast.error(error.message);
			logger.error("[EmptyStateAgents] Failed to persist selected agents", {
				agentId,
				error,
				projectPath,
			});
		}
	);
}

function handleWillSend() {
	if (!projectPath || !effectiveAgentId) {
		logger.warn("[worktree-debug] empty-state handleWillSend aborted", {
			projectPath,
			effectiveAgentId,
			activeWorktreePath,
			worktreePending,
		});
		return;
	}

	persistSelectedAgent(effectiveAgentId);

	logger.info("[worktree-debug] empty-state handleWillSend", {
		projectPath,
		projectName,
		effectiveAgentId,
		activeWorktreePath,
		worktreePending,
		effectiveWorktreePending,
		panelExists: panelStore.panels.some((panel) => panel.id === EMPTY_STATE_PANEL_ID),
	});

	ensureEmptyStatePanelContext({
		panelStore,
		panelId: EMPTY_STATE_PANEL_ID,
		projectPath,
		selectedAgentId: effectiveAgentId,
	});
	logger.info("[worktree-debug] empty-state panel context ensured", {
		panelId: EMPTY_STATE_PANEL_ID,
		projectPath,
		effectiveAgentId,
		panelProjectPath:
			panelStore.panels.find((panel) => panel.id === EMPTY_STATE_PANEL_ID && "projectPath" in panel)
				?.projectPath ?? null,
	});
	panelStore.focusPanel(EMPTY_STATE_PANEL_ID);
	return EMPTY_STATE_PANEL_ID;
}

function handleEmptyStateSessionCreated(sessionId: string) {
	logger.info("[worktree-debug] empty-state session created callback", {
		sessionId,
		projectPath,
		activeWorktreePath,
		worktreePending,
		effectiveWorktreePending,
	});
	const attached = attachSessionToEmptyStatePanel({
		panelStore,
		panelId: EMPTY_STATE_PANEL_ID,
		sessionId,
	});

	if (!attached) {
		onSessionCreated(sessionId);
	}
}
</script>

<div class="flex flex-col items-center justify-center h-full w-full max-w-2xl mx-auto px-6 py-12">
	<h1 class="mb-8 text-center font-sans text-[1.9rem] font-semibold tracking-tight text-foreground sm:text-4xl">
		What do you want to build?
	</h1>

	{#if canShowInput}
		<!-- Agent Input -->
		<div class="w-full">
			<AgentInput
				panelId={EMPTY_STATE_PANEL_ID}
				projectPath={projectPath ?? undefined}
				projectName={projectName ?? undefined}
				selectedAgentId={effectiveAgentId}
				voiceSessionId={EMPTY_STATE_PANEL_ID}
				disableSend={!canSendFromEmptyState}
				{availableAgents}
				onAgentChange={handleAgentChange}
				onSessionCreated={handleEmptyStateSessionCreated}
				onWillSend={handleWillSend}
				worktreePath={activeWorktreePath ?? undefined}
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
						onAgentChange={handleAgentChange}
					/>
					{#if showProjectPicker}
						<div class="h-full w-px bg-border/50"></div>
						<ProjectSelector
							selectedProject={effectiveProject}
							recentProjects={projects}
							onProjectChange={handleProjectChange}
							onBrowse={handleBrowseProject}
						/>
					{/if}
				{/snippet}
			</AgentInput>
			{#if projectPath}
				<div class="flex items-center h-7 mt-2 rounded-b-lg">
					<WorktreeToggleControl
						panelId={EMPTY_STATE_PANEL_ID}
						{projectPath}
						{projectName}
						{activeWorktreePath}
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
		</div>
	{:else}
		<p class="text-muted-foreground text-sm">
			{m.empty_panel_description()}
		</p>
	{/if}
</div>
