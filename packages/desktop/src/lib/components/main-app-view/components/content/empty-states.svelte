<script lang="ts">
import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
import AgentErrorCard from "$lib/acp/components/agent-panel/components/agent-error-card.svelte";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import AgentSelector from "$lib/acp/components/agent-selector.svelte";
import BranchPicker from "$lib/acp/components/branch-picker/branch-picker.svelte";
import ProjectSelector from "$lib/acp/components/project-selector.svelte";
import ProjectTable from "$lib/acp/components/add-repository/project-table.svelte";
import { getWorktreeProjectDefaultStore } from "$lib/acp/components/worktree/worktree-project-default-store.svelte.js";
import { Button } from "$lib/components/ui/button/index.js";
import { RoundedIcon } from "@acepe/ui";
import { getErrorCauseDetails } from "$lib/acp/errors/error-cause-details.js";
import type { ProjectWithSessions } from "$lib/acp/components/add-repository/open-project-dialog-props.js";
import {
	shouldShowDiscoveredProject,
	sortProjectsBySessionCount,
} from "$lib/acp/components/add-repository/project-discovery.js";
import { extractNameFromPath } from "$lib/acp/components/welcome-screen/welcome-screen-state.js";
import {
	type Project,
	type ProjectManager,
	isUnexpectedProjectError,
} from "$lib/acp/logic/project-manager.svelte.js";
import type { PreparedWorktreeLaunch } from "$lib/acp/types/worktree-info.js";
import { getPanelStore } from "$lib/acp/store/panel-store.svelte.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { ensureErrorReference } from "$lib/errors/error-reference.js";
import {
	openIssueReportDraft,
	resolveIssueActionLabel,
} from "$lib/errors/issue-report.js";
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
import {
	buildProjectImportErrorState,
	buildProjectImportIssueDraft,
	type EmptyStateProjectImportErrorState,
} from "./logic/empty-state-project-import-model.js";
import {
	createDelayedBranchMetadataScheduler,
	createEmptyStateBranchMetadataLoader,
	type EmptyStateBranchMetadataRefreshOptions,
} from "./logic/empty-state-branch-metadata-loader.js";
import {
	canShowEmptyStateInput,
	getEmptyStateProjectName,
	getEmptyStateProjectPath,
	isEmptyStateWorktreeEffectivelyPending,
	resolveEmptyStateProject,
	shouldLoadDiscoveredProjectsForEmptyState,
	shouldShowEmptyStateProjectPicker,
	shouldShowEmptyStateProjectChooser,
} from "./logic/empty-state-view-state.js";

interface Props {
	projectManager: ProjectManager;
	onSessionCreated: (id: string) => void;
}

const { projectManager, onSessionCreated }: Props = $props();

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const panelStore = getPanelStore();
const logger = createLogger({ id: "empty-state-worktree", name: "EmptyStateWorktree" });

// Per-project worktree default (loaded once at app root in main-app-view, read reactively here)
const worktreeProjectDefaultStore = getWorktreeProjectDefaultStore();

// Local state — only written by explicit user actions
let selectedAgentId: string | null = $state(null);
let selectedProject: Project | null = $state(null);
let activeWorktreePath: string | null = $state(null);
let worktreePending = $state(false);
let preparedWorktreeLaunch: PreparedWorktreeLaunch | null = $state(null);
let currentBranch = $state<string | null>(null);
let diffStats = $state<{ insertions: number; deletions: number } | null>(null);
let isGitRepo = $state<boolean | null>(null);
let projectImportError = $state<EmptyStateProjectImportErrorState | null>(null);
let discoveredProjectsLoading = $state(false);
let discoveredProjectsLoaded = $state(false);
let discoveredProjects = $state<ProjectWithSessions[]>([]);
let pendingProjectImports = $state<ProjectWithSessions[]>([]);
const branchMetadataLoader = createEmptyStateBranchMetadataLoader({
	gitClient: tauriClient.git,
	scheduler: createDelayedBranchMetadataScheduler(),
	writer: {
		reset() {
			currentBranch = null;
			diffStats = null;
			isGitRepo = null;
		},
		setIsGitRepo(value) {
			isGitRepo = value;
		},
		setCurrentBranch(value) {
			currentBranch = value;
		},
		setDiffStats(value) {
			diffStats = value;
		},
	},
});

// Derived
const availableAgents = $derived(
	getSpawnableSessionAgents(agentStore.agents, agentPreferencesStore.selectedAgentIds)
);
const projects = $derived(projectManager.projects);
const projectCount = $derived(projectManager.projectCount);
const pendingProjectImportPaths = $derived(
	new Set(pendingProjectImports.map((project) => project.path))
);
const pendingProjectImportCount = $derived(pendingProjectImportPaths.size);
const availableAgentIds = $derived(availableAgents.map((agent) => agent.id));

// Resolve effective agent: explicit selection → user default → first available
const effectiveAgentId = $derived(
	resolveEmptyStateAgentId({
		selectedAgentId,
		defaultAgentId: agentPreferencesStore.defaultAgentId,
		availableAgentIds,
	})
);

const effectiveProject = $derived(
	resolveEmptyStateProject({
		selectedProject,
		projects,
	})
);
const projectPath = $derived(getEmptyStateProjectPath(effectiveProject));
const projectName = $derived(getEmptyStateProjectName(effectiveProject));

const showProjectPicker = $derived(shouldShowEmptyStateProjectPicker(projects.length));
const showProjectChooser = $derived(shouldShowEmptyStateProjectChooser(projectCount));
const canShowInput = $derived(
	!showProjectChooser &&
		canShowEmptyStateInput({
			projectCount,
			availableAgentCount: availableAgents.length,
		})
);
const effectiveWorktreePending = $derived(
	isEmptyStateWorktreeEffectivelyPending({
		worktreePending,
		activeWorktreePath,
	})
);
const canSendFromEmptyState = $derived(
	canSendWithoutSession({
		projectPath,
		selectedAgentId: effectiveAgentId,
	})
);

function resetBranchPickerMetadata() {
	branchMetadataLoader.reset();
}

function refreshBranchPickerMetadata(
	targetProjectPath: string,
	options?: EmptyStateBranchMetadataRefreshOptions
) {
	branchMetadataLoader.refresh(targetProjectPath, options);
}

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
		projectPath: currentProjectPath,
		isProjectWorktreeEnabled: (path) => worktreeProjectDefaultStore.isEnabled(path),
	});
});

$effect(() => {
	const currentProjectPath = projectPath;
	if (currentProjectPath === null) {
		resetBranchPickerMetadata();
		return;
	}

	refreshBranchPickerMetadata(currentProjectPath);
});

$effect(() => {
	const currentProjectCount = projectCount;
	if (shouldLoadDiscoveredProjectsForEmptyState(currentProjectCount)) {
		void loadDiscoveredProjectsForEmptyState();
	}
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
		projectWorktreeDefault: worktreeProjectDefaultStore.isEnabled(project.path),
	});
	selectedProject = project;
	activeWorktreePath = null;
	preparedWorktreeLaunch = null;
	worktreePending = resolveEmptyStateWorktreePendingForProjectChange({
		projectPath: project.path,
		isProjectWorktreeEnabled: (path) => worktreeProjectDefaultStore.isEnabled(path),
	});
	logger.info("[worktree-debug] empty-state project change resolved", {
		projectPath: project.path,
		activeWorktreePath,
		worktreePendingAfter: worktreePending,
	});
}

function handleBrowseProject() {
	if (showProjectChooser) {
		void projectManager.browseProject().match(
			(project) => {
				if (project === null) {
					return;
				}
				stageProjectImport({
					path: project.path,
					name: project.name,
					agentCounts: new Map(),
					totalSessions: "loading",
				});
			},
			(error) => {
				if (!isUnexpectedProjectError(error)) {
					projectImportError = null;
					toast.error(error.message);
					return;
				}

				const errorReference = ensureErrorReference(error);
				const errorDetails = getErrorCauseDetails(error);
				projectImportError = buildProjectImportErrorState({
					error,
					causeDetails: errorDetails,
					reference: errorReference,
				});
			}
		);
		return;
	}

	void projectManager.importProject().match(
		(project) => {
			if (project !== null) {
				projectImportError = null;
			}
		},
		(error) => {
			if (!isUnexpectedProjectError(error)) {
				projectImportError = null;
				toast.error(error.message);
				return;
			}

			const errorReference = ensureErrorReference(error);
			const errorDetails = getErrorCauseDetails(error);
			projectImportError = buildProjectImportErrorState({
				error,
				causeDetails: errorDetails,
				reference: errorReference,
			});
		}
	);
}

function stageProjectImport(project: ProjectWithSessions): void {
	if (pendingProjectImportPaths.has(project.path)) {
		return;
	}

	pendingProjectImports = [
		{
			path: project.path,
			name: project.name,
			agentCounts: project.agentCounts,
			totalSessions: project.totalSessions,
		},
		...pendingProjectImports,
	];

	if (!discoveredProjects.some((candidate) => candidate.path === project.path)) {
		discoveredProjects = [
			{
				path: project.path,
				name: project.name,
				agentCounts: project.agentCounts,
				totalSessions: project.totalSessions,
			},
			...discoveredProjects,
		];
	}

	void tauriClient.history.countSessionsForProject(project.path).match(
		() => undefined,
		() => undefined
	);
}

function unstageProjectImport(path: string): void {
	pendingProjectImports = pendingProjectImports.filter((project) => project.path !== path);
}

async function loadDiscoveredProjectsForEmptyState(): Promise<void> {
	if (discoveredProjectsLoaded || discoveredProjectsLoading) {
		return;
	}

	discoveredProjectsLoading = true;
	discoveredProjects = [];

	const pathsResult = await tauriClient.history.listAllProjectPaths();
	pathsResult.match(
		(projectInfos) => {
			const deduped = new Map<string, ProjectWithSessions>();
			const discoverableProjectInfos = projectInfos.filter(shouldShowDiscoveredProject);

			for (const info of discoverableProjectInfos) {
				if (deduped.has(info.path)) continue;
				deduped.set(info.path, {
					path: info.path,
					name: extractNameFromPath(info.path),
					agentCounts: new Map(),
					totalSessions: "loading",
				});
			}

			discoveredProjects = Array.from(deduped.values());
			discoveredProjectsLoading = false;
			discoveredProjectsLoaded = true;

			for (const path of deduped.keys()) {
				void tauriClient.history.countSessionsForProject(path).match(
					(counts) => {
						const total = Object.values(counts.counts).reduce((sum, count) => sum + count, 0);
						discoveredProjects = sortProjectsBySessionCount(
							discoveredProjects.map((project) =>
								project.path === path
									? {
											path: project.path,
											name: project.name,
											agentCounts: new Map(
												Object.entries(counts.counts).map(([agentId, count]) => [agentId, count])
											),
											totalSessions: total,
										}
									: project
							)
						);
					},
					() => {
						discoveredProjects = sortProjectsBySessionCount(
							discoveredProjects.map((project) =>
								project.path === path
									? {
											path: project.path,
											name: project.name,
											agentCounts: project.agentCounts,
											totalSessions: "error",
										}
									: project
							)
						);
					}
				);
			}
		},
		(error) => {
			discoveredProjectsLoading = false;
			discoveredProjectsLoaded = true;
			toast.error(error.message);
		}
	);
}

async function handleDiscoveredProjectImport(path: string, name: string): Promise<void> {
	if (pendingProjectImportPaths.has(path)) {
		return;
	}

	const discoveredProject = discoveredProjects.find((project) => project.path === path);
	stageProjectImport(
		discoveredProject ?? {
			path,
			name,
			agentCounts: new Map(),
			totalSessions: "loading",
		}
	);
}

async function handleDiscoveredProjectRemove(path: string, name: string): Promise<void> {
	if (!pendingProjectImportPaths.has(path)) {
		return;
	}

	unstageProjectImport(path);
}

async function continueWithPendingProjectImports(): Promise<void> {
	if (pendingProjectImports.length === 0) {
		return;
	}

	for (const project of pendingProjectImports) {
		const result = await tauriClient.projects.importProject(project.path, project.name);
		if (result.isErr()) {
			toast.error(result.error.message);
			return;
		}

		projectManager.addProjectOptimistic(project.path, project.name);
	}

	pendingProjectImports = [];
	projectImportError = null;
	void projectManager.loadProjects();
}

async function copyProjectImportReferenceId() {
	const referenceId = projectImportError?.referenceId;
	if (!referenceId) {
		return;
	}

	await copyTextToClipboard(referenceId).match(
		() => {
			toast.success("Reference ID copied");
		},
		(error) => {
			toast.error(error.message);
		}
	);
}

const projectImportIssueDraft = $derived.by(() =>
	buildProjectImportIssueDraft({
		errorState: projectImportError,
		projectPath,
		projectName,
	})
);

function handleProjectImportIssueAction() {
	const draft = projectImportIssueDraft;
	if (draft === null) {
		return;
	}

	openIssueReportDraft(draft);
}

function handleBranchSelected(branch: string) {
	currentBranch = branch;
	if (!projectPath) {
		return;
	}
	refreshBranchPickerMetadata(projectPath, { loadDetails: true });
}

function handleInitGitRepo() {
	if (!projectPath) {
		return;
	}

	void tauriClient.git.init(projectPath).match(
		() => {
			refreshBranchPickerMetadata(projectPath, { loadDetails: true });
		},
		(error) => {
			const message = error.cause?.message ?? error.message ?? "Failed to initialize git";
			toast.error(message);
			logger.error("[EmptyStateBranchPicker] Failed to initialize git", {
				projectPath,
				error,
			});
		}
	);
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
		panelExists: panelStore.getTopLevelAgentPanel(EMPTY_STATE_PANEL_ID) !== undefined,
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
		panelProjectPath: panelStore.getTopLevelAgentPanel(EMPTY_STATE_PANEL_ID)?.projectPath ?? null,
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

<div class="flex flex-col items-center justify-center h-full w-full py-6">
	{#if showProjectChooser}
		<h1 class="mb-4 text-center font-sans text-[1.65rem] font-semibold tracking-tight text-foreground sm:text-[2rem]">
			Choose a project to start
		</h1>
	{/if}

	<div class="flex w-full max-w-[40rem] flex-col px-6">
	{#if canShowInput}
		<!-- Agent Input -->
		<div class="w-full [&_[contenteditable=true]]:min-h-[4.5rem]">
			{#if projectImportError}
				<div class="mb-3">
					<AgentErrorCard
						title={projectImportError.title}
						summary={projectImportError.summary}
						details={projectImportError.details}
						onDismiss={() => {
							projectImportError = null;
						}}
						issueActionLabel={projectImportIssueDraft
							? resolveIssueActionLabel(projectImportIssueDraft)
							: "Create issue"}
						onIssueAction={projectImportIssueDraft ? handleProjectImportIssueAction : undefined}
					/>
				</div>
			{/if}
			{#snippet newThreadProjectControl()}
				{#if showProjectPicker}
					<ProjectSelector
						selectedProject={effectiveProject}
						recentProjects={projects}
						onProjectChange={handleProjectChange}
						onBrowse={handleBrowseProject}
						showLabel
					/>
				{:else if effectiveProject}
					<ProjectSelector
						selectedProject={effectiveProject}
						recentProjects={projects}
						onProjectChange={handleProjectChange}
						onBrowse={handleBrowseProject}
						showLabel
					/>
				{/if}
			{/snippet}
			{#snippet newThreadAgentControl()}
				<AgentSelector
					{availableAgents}
					currentAgentId={effectiveAgentId}
					onAgentChange={handleAgentChange}
					showLabel
				/>
			{/snippet}
			{#snippet newThreadBranchControl()}
				{#if projectPath}
					<BranchPicker
						{projectPath}
						{currentBranch}
						{diffStats}
						{isGitRepo}
						variant="setupBarChip"
						onBranchSelected={handleBranchSelected}
						onInitGitRepo={handleInitGitRepo}
					/>
				{/if}
			{/snippet}
			<AgentInput
				panelId={EMPTY_STATE_PANEL_ID}
				composerInputClass="flex-shrink-0 rounded-xl bg-input/30 shadow-sm"
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
				newThreadContext={{
					project: newThreadProjectControl,
					agent: newThreadAgentControl,
					branch: newThreadBranchControl,
					setupBarAlign: "start",
					showWorktree: projectPath !== null,
					worktreeOn: effectiveWorktreePending,
					worktreeDisabled: false,
					onWorktreeToggle: (on) => {
						preparedWorktreeLaunch = null;
						worktreePending = on;
						if (projectPath) {
							void worktreeProjectDefaultStore.set(projectPath, on);
						}
					},
				}}
			/>
		</div>
	{:else}
		<div class="flex w-full flex-col items-center gap-3">
			{#if projectImportError}
				<div class="w-full">
					<AgentErrorCard
						title={projectImportError.title}
						summary={projectImportError.summary}
						details={projectImportError.details}
						onDismiss={() => {
							projectImportError = null;
						}}
						issueActionLabel={projectImportIssueDraft
							? resolveIssueActionLabel(projectImportIssueDraft)
							: "Create issue"}
						onIssueAction={projectImportIssueDraft ? handleProjectImportIssueAction : undefined}
					/>
				</div>
			{/if}
			{#if showProjectChooser}
				<div class="flex w-full max-w-[42rem] flex-col gap-3">
					<div class="flex justify-end">
						<Button
							variant="ghost"
							size="icon"
							title="Browse in Finder"
							aria-label="Browse in Finder"
							onclick={handleBrowseProject}
						>
							<RoundedIcon name="folder" class="size-4" />
						</Button>
					</div>
					<div class="flex max-h-[min(21rem,42vh)] min-h-0 flex-col overflow-y-auto pr-1">
						<ProjectTable
							projects={discoveredProjects}
							loading={discoveredProjectsLoading}
							addedPaths={pendingProjectImportPaths}
							onImport={handleDiscoveredProjectImport}
							onUndo={handleDiscoveredProjectRemove}
						/>
					</div>
					{#if pendingProjectImportCount > 0}
						<div class="flex items-center justify-between border-t border-border/40 pt-2">
							<span class="text-xs text-muted-foreground">
								{pendingProjectImportCount === 1
									? "1 project selected"
									: `${pendingProjectImportCount} projects selected`}
							</span>
							<Button
								variant="default"
								size="sm"
								onclick={continueWithPendingProjectImports}
							>
								{"Continue"}
							</Button>
						</div>
					{/if}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">
					{"Create a new session to begin working with an AI agent on your project."}
				</p>
			{/if}
		</div>
	{/if}
	</div>
</div>
