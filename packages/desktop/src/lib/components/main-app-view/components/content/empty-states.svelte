<script lang="ts">
import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
import AgentSelector from "$lib/acp/components/agent-selector.svelte";
import ProjectSelector from "$lib/acp/components/project-selector.svelte";
import PreSessionWorktreeCard from "$lib/acp/components/agent-panel/components/pre-session-worktree-card.svelte";
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
import { loadWorktreeEnabled } from "$lib/acp/components/worktree-toggle/worktree-storage.js";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { PreparedWorktreeLaunch } from "$lib/acp/types/worktree-info.js";
import { getPanelStore } from "$lib/acp/store/panel-store.svelte.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import * as m from "$lib/messages.js";
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
let preparedWorktreeLaunch: PreparedWorktreeLaunch | null = $state(null);

// Derived
const availableAgents = $derived(
	getSpawnableSessionAgents(agentStore.agents, agentPreferencesStore.selectedAgentIds)
);
const projects = $derived(projectManager.projects);
const availableAgentIds = $derived(availableAgents.map((agent) => agent.id));

// Resolve effective agent: explicit selection → user default → first available
const effectiveAgentId = $derived(
	resolveEmptyStateAgentId({
		selectedAgentId,
		defaultAgentId: agentPreferencesStore.defaultAgentId,
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
	preparedWorktreeLaunch = null;
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
		pendingWorktreeEnabled: effectiveWorktreePending,
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
	preparedWorktreeLaunch = null;

	if (!attached) {
		onSessionCreated(sessionId);
	}
}
</script>

<div class="flex flex-col items-center justify-center h-full w-full py-12">
	<h1 class="mb-8 text-center font-sans text-[1.9rem] font-semibold tracking-tight text-foreground sm:text-4xl">
		What do you want to build?
	</h1>

	<div class="flex w-full max-w-[29.4rem] flex-col px-6">
	{#if canShowInput}
		<!-- Agent Input -->
		<div class="w-full">
			{#if projectPath}
				<div class="mb-2">
					<PreSessionWorktreeCard
						pendingWorktreeEnabled={effectiveWorktreePending}
						alwaysEnabled={globalWorktreeDefault}
						{projectPath}
						onYes={() => {
							const store = getWorktreeDefaultStore();
							if (store.globalDefault) {
								void store.set(false);
							}
							preparedWorktreeLaunch = null;
							worktreePending = true;
						}}
						onNo={() => {
							const store = getWorktreeDefaultStore();
							if (store.globalDefault) {
								void store.set(false);
							}
							preparedWorktreeLaunch = null;
							worktreePending = false;
						}}
						onAlways={() => {
							const store = getWorktreeDefaultStore();
							const toggled = !store.globalDefault;
							void store.set(toggled);
							if (!toggled) {
								preparedWorktreeLaunch = null;
							}
							worktreePending = toggled;
						}}
						onDismiss={() => {
							preparedWorktreeLaunch = null;
							worktreePending = false;
						}}
					/>
				</div>
			{/if}
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
		</div>
	{:else}
		<p class="text-muted-foreground text-sm">
			{m.empty_panel_description()}
		</p>
	{/if}
	</div>
</div>
