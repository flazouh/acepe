<script lang="ts">
import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
import AgentSelector from "$lib/acp/components/agent-selector.svelte";
import ProjectSelector from "$lib/acp/components/project-selector.svelte";
import { WorktreeToggleControl } from "$lib/acp/components/worktree-toggle/index.js";
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
import { loadWorktreeEnabled } from "$lib/acp/components/worktree-toggle/worktree-storage.js";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getAgentStore } from "$lib/acp/store/agent-store.svelte.js";
import { getPanelStore } from "$lib/acp/store/panel-store.svelte.js";
import { getAgentPreferencesStore } from "$lib/acp/store/index.js";
import * as m from "$lib/paraglide/messages.js";

import logo from "../../../../../../../../assets/logo.svg?url";
import {
	attachSessionToEmptyStatePanel,
	ensureEmptyStatePanelContext,
} from "./logic/empty-state-panel-context.js";
import {
	EMPTY_STATE_PANEL_ID,
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

// Global worktree default (loaded once at app root in main-app-view, read reactively here)
const worktreeDefaultStore = getWorktreeDefaultStore();
const globalWorktreeDefault = $derived(worktreeDefaultStore.globalDefault);

// Local state — only written by explicit user actions
let selectedAgentId: string | null = $state(null);
let selectedProject: Project | null = $state(null);
let activeWorktreePath: string | null = $state(null);
let worktreePending = $state(false);

// Derived
const availableAgents = $derived(agentPreferencesStore.getPanelSelectableAgents(agentStore.agents));
const projects = $derived(projectManager.projects);

// Resolve effective agent: user selection, then default
const effectiveAgentId = $derived(
	selectedAgentId ?? (availableAgents.length > 0 ? agentStore.getDefaultAgentId() : null)
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
	selectedProject = project;
	activeWorktreePath = null;
	worktreePending = resolveEmptyStateWorktreePendingForProjectChange({
		globalWorktreeDefault,
		loadEnabled: loadWorktreeEnabled,
	});
}

function handleBrowseProject() {
	projectManager.importProject();
}

function handleWillSend() {
	if (!projectPath || !effectiveAgentId) {
		return;
	}

	ensureEmptyStatePanelContext({
		panelStore,
		panelId: EMPTY_STATE_PANEL_ID,
		projectPath,
		selectedAgentId: effectiveAgentId,
	});
	panelStore.focusPanel(EMPTY_STATE_PANEL_ID);
}

function handleEmptyStateSessionCreated(sessionId: string) {
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
	<!-- Logo and Brand Header -->
	<div class="flex items-center gap-3 mb-8">
		<img src={logo} alt="Acepe Logo" class="w-10 h-10" />
		<h1 class="font-sans font-semibold text-3xl tracking-tight text-foreground">ACEPE</h1>
	</div>

	{#if canShowInput}
		<!-- Agent Input -->
		<div class="w-full">
			<AgentInput
				panelId={EMPTY_STATE_PANEL_ID}
				projectPath={projectPath ?? undefined}
				projectName={projectName ?? undefined}
				selectedAgentId={effectiveAgentId}
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
