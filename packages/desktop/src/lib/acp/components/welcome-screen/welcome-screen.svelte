<script lang="ts">
import { BrandLockup, BrandShaderBackground, Button, PillButton } from "@acepe/ui";
import { ResultAsync } from "neverthrow";
import { onDestroy, onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import AgentErrorCard from "$lib/acp/components/agent-panel/components/agent-error-card.svelte";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import { getErrorCauseDetails } from "$lib/acp/errors/error-cause-details.js";
import { isUnexpectedProjectError } from "$lib/acp/logic/project-manager.svelte.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { ensureErrorReference } from "$lib/errors/error-reference.js";
import {
	buildIssueReportDraft,
	openIssueReportDraft,
	resolveIssueActionLabel,
} from "$lib/errors/issue-report.js";
import * as m from "$lib/messages.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { ProjectWithSessions } from "../add-repository/open-project-dialog-props.js";

import {
	shouldShowDiscoveredProject,
	sortProjectsBySessionCount,
} from "../add-repository/project-discovery.js";
import ProjectTable from "../add-repository/project-table.svelte";
import type { WelcomeScreenProps } from "./welcome-screen-props.js";

const SPLASH_AGENTS: { id: string; alt: string }[] = [
	{ id: "claude-code", alt: "Claude" },
	{ id: "copilot", alt: "GitHub Copilot" },
	{ id: "codex", alt: "Codex" },
	{ id: "cursor", alt: "Cursor" },
	{ id: "opencode", alt: "OpenCode" },
];

type OnboardingStep = "splash" | "agents" | "projects" | "scanning";

interface OnboardingImportErrorState {
	readonly title: string;
	readonly summary: string;
	readonly details: string;
	readonly referenceId: string;
	readonly referenceSearchable: boolean;
}

let { onProjectImported, onDismiss }: WelcomeScreenProps = $props();

let onboardingStep = $state<OnboardingStep>("splash");
let onboardingProjectsLoading = $state(false);
let onboardingProjects = $state<ProjectWithSessions[]>([]);
let onboardingAddedPaths = $state<Set<string>>(new Set());
let onboardingSelectedAgents = $state<string[]>([]);
let onboardingBusyMessage = $state("");
let onboardingImportError = $state<OnboardingImportErrorState | null>(null);
let onboardingImportProjectPath = $state<string | null>(null);
let onboardingImportProjectName = $state<string | null>(null);

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const filteredProjects = $derived(
	filterProjectsBySelectedAgents(onboardingProjects, onboardingSelectedAgents)
);

// Handle Cmd+Enter keyboard shortcut (advances from splash to agents)
function handleKeydown(event: KeyboardEvent) {
	if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
		event.preventDefault();
		if (onboardingStep === "splash") {
			advanceFromSplash();
		}
	}
}

function advanceFromSplash() {
	onboardingStep = "agents";
	onboardingSelectedAgents = getOnboardingDefaultAgents();
	void loadExistingProjects();
	void loadOnboardingProjects();
}

function getOnboardingDefaultAgents(): string[] {
	return [];
}

function toggleOnboardingAgent(agentId: string): void {
	const current = new SvelteSet(onboardingSelectedAgents);
	if (current.has(agentId)) {
		if (current.size === 1) {
			return;
		}
		current.delete(agentId);
	} else {
		current.add(agentId);
	}
	onboardingSelectedAgents = Array.from(current);
}

async function loadExistingProjects() {
	const result = await tauriClient.projects.getProjects();
	result.match(
		(existingProjects) => {
			onboardingAddedPaths = new Set(existingProjects.map((p) => p.path));
		},
		(error) => {
			console.warn("Failed to load existing projects:", error);
		}
	);
}

async function handleOnboardingImport(path: string, name: string) {
	if (onboardingAddedPaths.has(path)) {
		return;
	}

	const result = await tauriClient.projects.importProject(path, name);

	result.match(
		() => {
			onboardingImportError = null;
			onboardingImportProjectPath = null;
			onboardingImportProjectName = null;
			onboardingAddedPaths = new Set([...onboardingAddedPaths, path]);
			toast.success(m.open_project_added_toast({ name }));
		},
		(error) => {
			if (!isUnexpectedProjectError(error)) {
				onboardingImportError = null;
				onboardingImportProjectPath = null;
				onboardingImportProjectName = null;
				toast.error(error.message);
				return;
			}

			const errorReference = ensureErrorReference(error);
			const errorDetails = getErrorCauseDetails(error);
			onboardingImportProjectPath = path;
			onboardingImportProjectName = name;
			onboardingImportError = {
				title: "Project import failed",
				summary: errorDetails.rootCause ?? error.message,
				details: errorDetails.formatted,
				referenceId: errorReference.referenceId,
				referenceSearchable: errorReference.searchable,
			};
		}
	);

	if (result.isOk()) {
		onProjectImported(path, name);
	}
}

async function copyOnboardingImportReferenceId() {
	const referenceId = onboardingImportError?.referenceId;
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

function createOnboardingIssueDraft() {
	if (
		onboardingImportError === null ||
		onboardingImportProjectPath === null ||
		onboardingImportProjectName === null
	) {
		return null;
	}

	return buildIssueReportDraft({
		title: `Project import failed: ${onboardingImportError.summary}`,
		summary: onboardingImportError.summary,
		details: onboardingImportError.details,
		referenceId: onboardingImportError.referenceId,
		referenceSearchable: onboardingImportError.referenceSearchable,
		surface: "welcome-screen-project-import",
		diagnosticsSummary: onboardingImportError.summary,
		metadata: [
			{
				label: "Project Path",
				value: onboardingImportProjectPath,
			},
			{
				label: "Project Name",
				value: onboardingImportProjectName,
			},
		],
	});
}

const onboardingIssueDraft = $derived.by(() => createOnboardingIssueDraft());

function handleOnboardingIssueAction() {
	if (onboardingIssueDraft === null) {
		return;
	}

	openIssueReportDraft(onboardingIssueDraft);
}

function extractNameFromPath(path: string): string {
	const segments = path.split("/").filter((segment) => segment.length > 0);
	return segments.length > 0 ? (segments[segments.length - 1] ?? path) : path;
}

/**
 * Filters projects to show only those with sessions from selected agents.
 * If no agents are selected, shows all projects (inverted logic).
 */
function filterProjectsBySelectedAgents(
	projects: ProjectWithSessions[],
	selectedAgentIds: string[]
): ProjectWithSessions[] {
	// If no agents selected, show all projects
	if (selectedAgentIds.length === 0) {
		return projects;
	}

	const selectedSet = new Set(selectedAgentIds);

	// Filter: keep only projects where at least one selected agent has sessions
	return projects.filter((project) => {
		return Array.from(selectedSet).some((agentId) => {
			const count = project.agentCounts.get(agentId);
			return typeof count === "number" && count > 0;
		});
	});
}

async function loadOnboardingProjects(): Promise<void> {
	onboardingProjectsLoading = true;
	onboardingProjects = [];

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

			onboardingProjects = Array.from(deduped.values());
			onboardingProjectsLoading = false;

			for (const path of deduped.keys()) {
				void tauriClient.history.countSessionsForProject(path).match(
					(counts) => {
						const total = Object.values(counts.counts).reduce((sum, count) => sum + count, 0);
						onboardingProjects = sortProjectsBySessionCount(
							onboardingProjects.map((project) =>
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
						onboardingProjects = sortProjectsBySessionCount(
							onboardingProjects.map((project) =>
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
			onboardingProjectsLoading = false;
			toast.error(error.message);
		}
	);
}

onMount(() => {
	window.addEventListener("keydown", handleKeydown);
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeydown);
});

async function finishOnboarding(): Promise<void> {
	if (onboardingSelectedAgents.length === 0) {
		toast.error("Select at least one agent.");
		return;
	}

	onboardingStep = "scanning";
	onboardingBusyMessage = "Completing onboarding...";

	const completionResult = await agentPreferencesStore.completeOnboarding(onboardingSelectedAgents);
	completionResult.match(
		() => onDismiss(),
		(error) => {
			toast.error(error.message);
			onboardingStep = "projects";
		}
	);
}
</script>

<!-- Shader background layer (persistent across all steps) -->
<BrandShaderBackground />

<!-- Content layer -->
<div
	class="relative z-10 flex flex-col items-center justify-center h-full w-full max-w-4xl mx-auto px-6 py-12"
>
	{#if onboardingStep === "splash"}
		<!-- Splash: 16:9 card with welcome message -->
		<div
			class="flex aspect-video w-[640px] flex-col rounded-2xl bg-background p-8"
		>
			<!-- Top Left: Logo + Label -->
			<BrandLockup
				class="gap-3"
				markClass="h-8 w-8"
				wordmarkClass="text-lg text-foreground"
			/>

			<!-- Center: Welcome Message -->
			<div class="flex-1 flex flex-col justify-center gap-4">
				<h1 class="text-3xl font-bold text-foreground">{m.splash_welcome()}</h1>
				<p class="text-base text-muted-foreground max-w-lg">
					{m.splash_description()}
				</p>
			</div>

			<!-- Bottom: Agent Icons (left) + CTA Button (right) -->
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					{#each SPLASH_AGENTS as agent (agent.id)}
						<AgentIcon agentId={agent.id} size={20} class="opacity-60" />
					{/each}
				</div>
				<div class="flex items-center rounded-xl border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0">
					<Button
						variant="headerAction"
						size="headerAction"
						class="group/open-pr h-9 gap-2 rounded-none border-0 bg-transparent px-3 text-sm shadow-none"
						onclick={advanceFromSplash}
					>
						<span>{m.splash_enter()}</span>
					</Button>
				</div>
			</div>
		</div>
	{:else}
		<!-- Agents / Projects / Scanning steps -->
		{#if onboardingStep !== "projects"}
			<BrandLockup
				class="mb-8 gap-3"
				markClass="h-10 w-10"
				wordmarkClass="text-3xl text-foreground tracking-[0.14em]"
			/>
		{/if}

		<div
			class="w-full rounded-xl border border-border/50 bg-background {onboardingStep === 'projects'
				? 'mx-auto flex max-h-[min(560px,calc(100vh-10rem))] max-w-2xl flex-col overflow-hidden p-5'
				: 'max-w-3xl p-6'}"
		>
			{#if onboardingStep === "agents"}
				<div class="space-y-6">
					<div class="text-center space-y-2">
						<h2 class="text-2xl font-semibold">{m.welcome_choose_agents()}</h2>
						<p class="text-sm text-muted-foreground">
							{m.welcome_agents_description()}
						</p>
					</div>

					<div class="grid w-fit grid-cols-3 grid-rows-2 gap-4 mx-auto">
						{#each agentStore.agents as agent (agent.id)}
							<Button
								variant="headerAction"
								size="headerAction"
								class="h-14 w-14 justify-center rounded-xl border-0 bg-transparent p-0 shadow-none"
								aria-label={agent.name}
								aria-pressed={onboardingSelectedAgents.includes(agent.id)}
								title={agent.name}
								onclick={() => toggleOnboardingAgent(agent.id)}
							>
								<AgentIcon
									agentId={agent.id}
									size={28}
									class={onboardingSelectedAgents.includes(agent.id)
										? "opacity-100 transition-opacity"
										: "opacity-50 transition-opacity"}
								/>
							</Button>
						{/each}
					</div>

					<div class="flex justify-end gap-3">
						<div class="flex items-center rounded-xl border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0">
							<Button
								variant="headerAction"
								size="headerAction"
								class="h-9 rounded-none border-0 bg-transparent px-3 text-sm shadow-none"
								disabled={onboardingSelectedAgents.length === 0}
								onclick={() => (onboardingStep = "projects")}
							>
								{m.common_confirm()}
							</Button>
						</div>
					</div>
				</div>
			{:else if onboardingStep === "projects"}
				<div class="flex min-h-0 flex-col space-y-4">
					{#if onboardingImportError}
						<AgentErrorCard
							title={onboardingImportError.title}
							summary={onboardingImportError.summary}
							details={onboardingImportError.details}
							referenceId={onboardingImportError.referenceId}
							referenceSearchable={onboardingImportError.referenceSearchable}
							onDismiss={() => {
								onboardingImportError = null;
								onboardingImportProjectPath = null;
								onboardingImportProjectName = null;
							}}
							onCopyReferenceId={copyOnboardingImportReferenceId}
							issueActionLabel={onboardingIssueDraft
								? resolveIssueActionLabel(onboardingIssueDraft)
								: "Create issue"}
							onIssueAction={onboardingIssueDraft ? handleOnboardingIssueAction : undefined}
						/>
					{/if}
					{#if filteredProjects.length === 0 && !onboardingProjectsLoading}
						<div class="flex flex-col items-center justify-center py-12 text-center space-y-3">
							<p class="text-sm text-muted-foreground">{m.onboarding_projects_no_match()}</p>
							<p class="text-xs text-muted-foreground/70">
								{m.onboarding_projects_change_agents()}
							</p>
						</div>
					{:else}
						<div class="min-h-0 flex-1 overflow-y-auto">
							<ProjectTable
								projects={filteredProjects}
								loading={onboardingProjectsLoading}
								addedPaths={onboardingAddedPaths}
								selectedAgentIds={onboardingSelectedAgents}
								onImport={handleOnboardingImport}
							/>
						</div>
					{/if}

					<div class="flex justify-between pt-4">
						<div class="flex items-center rounded-xl border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0">
							<Button
								variant="headerAction"
								size="headerAction"
								class="h-9 rounded-none border-0 bg-transparent px-3 text-sm shadow-none"
								onclick={() => (onboardingStep = "agents")}
							>
								{m.common_back()}
							</Button>
						</div>
						<div class="flex gap-3">
							<PillButton variant="ghost" onclick={() => finishOnboarding()}>
								{m.welcome_skip_for_now()}
							</PillButton>
							<div class="flex items-center rounded-xl border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0">
								<Button
									variant="headerAction"
									size="headerAction"
									class="h-9 rounded-none border-0 bg-transparent px-3 text-sm shadow-none"
									onclick={() => finishOnboarding()}
								>
									{m.welcome_finish()}
								</Button>
							</div>
						</div>
					</div>
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center py-12 gap-3">
					<Spinner class="h-8 w-8" />
					<p class="text-sm text-muted-foreground">{onboardingBusyMessage || m.common_loading()}</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
