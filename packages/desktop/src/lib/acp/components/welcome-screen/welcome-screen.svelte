<script lang="ts">
import { BrandLockup, BrandShaderBackground, Button } from "@acepe/ui";
import { ResultAsync } from "neverthrow";
import { ArrowRight } from "phosphor-svelte";
import { onDestroy, onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import AgentErrorCard from "$lib/acp/components/agent-panel/components/agent-error-card.svelte";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { getErrorCauseDetails } from "$lib/acp/errors/error-cause-details.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { ensureErrorReference } from "$lib/errors/error-reference.js";
import {
	buildIssueReportDraft,
	openIssueReportDraft,
	resolveIssueActionLabel,
} from "$lib/errors/issue-report.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { ProjectWithSessions } from "../add-repository/open-project-dialog-props.js";

import {
	shouldShowDiscoveredProject,
	sortProjectsBySessionCount,
} from "../add-repository/project-discovery.js";
import ProjectTable from "../add-repository/project-table.svelte";
import { getOnboardingSelectableAgents } from "./onboarding-agent-discovery.js";
import type { WelcomeScreenProps } from "./welcome-screen-props.js";

const SPLASH_AGENTS: { id: string; alt: string }[] = [
	{ id: "claude-code", alt: "Claude" },
	{ id: "copilot", alt: "GitHub Copilot" },
	{ id: "codex", alt: "Codex" },
	{ id: "cursor", alt: "Cursor" },
	{ id: "opencode", alt: "OpenCode" },
];

// Vendor labels grounded in reality — confident product data, not marketing copy.
const AGENT_VENDORS: Record<string, string> = {
	"claude-code": "Anthropic",
	cursor: "Cursor",
	copilot: "GitHub",
	opencode: "SST",
	codex: "OpenAI",
};

type OnboardingStep = "splash" | "agents" | "projects" | "scanning";

// Visible steps for the progress indicator — scanning is an internal transition, not a step.
const ONBOARDING_STEPS: readonly OnboardingStep[] = ["splash", "agents", "projects"] as const;

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
const onboardingAvailableAgents = $derived(getOnboardingSelectableAgents(agentStore.agents));
const filteredProjects = $derived(
	filterProjectsBySelectedAgents(onboardingProjects, onboardingSelectedAgents)
);
// Index into ONBOARDING_STEPS for the progress indicator. Scanning reuses the projects step.
const currentStepIndex = $derived(
	onboardingStep === "scanning" ? 2 : ONBOARDING_STEPS.indexOf(onboardingStep)
);

function isUnexpectedOnboardingImportError(error: AppError): boolean {
	return error.code !== "VALIDATION_ERROR";
}

// Handle Cmd+Enter keyboard shortcut (advances between non-terminal steps)
function handleKeydown(event: KeyboardEvent) {
	if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
		event.preventDefault();
		if (onboardingStep === "splash") {
			advanceFromSplash();
		} else if (onboardingStep === "agents" && onboardingSelectedAgents.length > 0) {
			onboardingStep = "projects";
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
			toast.success(`${name} added to repositories`);
		},
		(error) => {
			if (!isUnexpectedOnboardingImportError(error)) {
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

// Track cursor over interactive surfaces so a soft spotlight can follow it.
// No $effect — pointer handler writes CSS custom properties directly on the element.
function trackPointer(event: PointerEvent) {
	const target = event.currentTarget as HTMLElement;
	const rect = target.getBoundingClientRect();
	target.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
	target.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
}
</script>

<!-- Shader background layer (persistent across all steps) -->
<BrandShaderBackground />

<!-- Soft vignette: pulls focus toward center, dampens shader edges without adding a visible frame. -->
<div
	class="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_48%,transparent,rgba(0,0,0,0.55)_100%)]"
	aria-hidden="true"
></div>

<!-- Brand lockup + progress indicator — pinned top-left, persistent. -->
<div class="absolute left-9 top-8 z-20 flex flex-col gap-4">
	<BrandLockup
		class="gap-2.5"
		markClass="h-6 w-6"
		wordmarkClass="text-[0.75rem] font-medium tracking-[0.24em] text-white/70"
	/>
	<!-- 3-segment progress. Calm, honest, no numbers or percentages. -->
	<div class="flex items-center gap-1.5" aria-label="Onboarding progress" role="progressbar">
		{#each ONBOARDING_STEPS as _, index (index)}
			<span
				class="progress-pill {index === currentStepIndex
					? 'progress-pill--active'
					: index < currentStepIndex
						? 'progress-pill--done'
						: ''}"
			></span>
		{/each}
	</div>
</div>

<!-- Content layer. Card mounts with a short opacity breath whenever the step changes. -->
<div class="onboarding-surface relative z-10 flex min-h-full w-full items-center justify-center px-6 py-24">
	{#key onboardingStep}
	{#if onboardingStep === "splash"}
		<div class="onboarding-card bg-card flex w-full max-w-[600px] flex-col gap-10 rounded-3xl p-8">
			<!-- Headline mirrors the marketing hero — one voice from landing to desktop. -->
			<div class="flex flex-col gap-5">
				<h1 class="text-[2.25rem] font-medium leading-[1.08] tracking-[-0.028em] text-white">
					{"The Agentic Developer Environment"}
				</h1>
				<p class="text-[0.9375rem] leading-[1.55] text-white/55">
					{"Run Claude Code, Codex, Cursor Agent, and OpenCode side by side. Orchestrate parallel sessions, track every change, and ship from plan to PR. All in one window."}
				</p>
			</div>

			<!-- Agent strip: full-color brand marks, unframed. -->
			<div class="flex items-center gap-3">
				{#each SPLASH_AGENTS as agent (agent.id)}
					<div class="flex size-8 items-center justify-center rounded-lg bg-white/[0.04]">
						<AgentIcon agentId={agent.id} size={18} />
					</div>
				{/each}
			</div>

			<!-- CTA row. No border divider — whitespace separates. -->
			<div class="flex items-center justify-between">
				<span class="flex items-center gap-1.5 text-[0.75rem] text-white/40">
					<kbd class="keycap">⌘</kbd>
					<kbd class="keycap">↵</kbd>
					<span class="ml-1">{"to continue"}</span>
				</span>
				<Button
					variant="default"
					size="lg"
					class="h-9 gap-2 rounded-xl bg-primary px-5 text-[0.9375rem] font-medium text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_10px_24px_-12px_rgba(0,0,0,0.55)] hover:bg-primary/92"
					onclick={advanceFromSplash}
				>
					<span>{"Get started"}</span>
					<ArrowRight weight="bold" class="size-4" />
				</Button>
			</div>
		</div>
	{:else if onboardingStep === "agents"}
		<div class="onboarding-card bg-card flex w-full max-w-[760px] flex-col gap-8 rounded-3xl p-8">
			<div class="flex flex-col gap-3">
				<h2 class="text-[1.625rem] font-medium leading-tight tracking-[-0.02em] text-white">
					{"Choose your agents"}
				</h2>
				<p class="max-w-[460px] text-[0.9375rem] leading-[1.55] text-white/55">
					{"Pick the agents you work with. We'll surface projects where you've used them."}
				</p>
			</div>

			<div class="grid grid-cols-3 gap-2.5">
				{#each onboardingAvailableAgents as agent (agent.id)}
					{@const isSelected = onboardingSelectedAgents.includes(agent.id)}
					{@const vendor = AGENT_VENDORS[agent.id] ?? ""}
					<button
						type="button"
						aria-pressed={isSelected}
						aria-label={agent.name}
						onclick={() => toggleOnboardingAgent(agent.id)}
						onpointermove={trackPointer}
						class="agent-card group relative flex items-center gap-3.5 rounded-xl px-4 py-3.5 text-left {isSelected
							? 'agent-card--selected'
							: ''}"
					>
						<!-- Icon tile. Selection lifts the tile surface and unmutes the icon;
						     the icon itself keeps its native brand color when selected. -->
						<div
							class="flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 {isSelected
								? 'bg-white/10'
								: 'bg-white/[0.045] group-hover:bg-white/[0.075]'}"
						>
							<AgentIcon
								agentId={agent.id}
								size={20}
								class="agent-icon {isSelected ? '' : 'agent-icon--monochrome'}"
							/>
						</div>
						<div class="flex min-w-0 flex-col gap-0.5">
							<span
								class="truncate text-[0.875rem] font-medium leading-tight transition-colors duration-200 {isSelected
									? 'text-white'
									: 'text-white/85 group-hover:text-white'}"
							>
								{agent.name}
							</span>
							{#if vendor}
								<span class="truncate text-[0.6875rem] tracking-wide text-white/35">
									{vendor}
								</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>

			<div class="flex items-center justify-between">
				<span class="flex items-center gap-1.5 text-[0.75rem] text-white/40">
					{#if onboardingSelectedAgents.length === 0}
						<span>{"Select at least one agent"}</span>
					{:else}
						<kbd class="keycap">⌘</kbd>
						<kbd class="keycap">↵</kbd>
						<span class="ml-1">{`to continue · ${onboardingSelectedAgents.length} selected`}</span>
					{/if}
				</span>
				<Button
					variant="default"
					size="lg"
					class="h-9 gap-2 rounded-xl bg-primary px-5 text-[0.9375rem] font-medium text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_10px_24px_-12px_rgba(0,0,0,0.55)] hover:bg-primary/92 disabled:bg-white/[0.06] disabled:text-white/30 disabled:shadow-none"
					disabled={onboardingSelectedAgents.length === 0}
					onclick={() => (onboardingStep = "projects")}
				>
					<span>{"Continue"}</span>
					<ArrowRight weight="bold" class="size-4" />
				</Button>
			</div>
		</div>
	{:else if onboardingStep === "projects"}
		<div
			class="onboarding-card bg-card flex max-h-[min(640px,calc(100vh-10rem))] w-full max-w-[760px] flex-col rounded-3xl"
		>
			<div class="flex flex-col gap-3 px-8 pt-8 pb-6">
				<h2 class="text-[1.625rem] font-medium leading-tight tracking-[-0.02em] text-white">
					{"Import your projects"}
				</h2>
				<p class="max-w-[480px] text-[0.9375rem] leading-[1.55] text-white/55">
					{"We found these projects where your selected agents have sessions. Pick the ones you want to bring in."}
				</p>
			</div>

			<div class="flex min-h-0 flex-1 flex-col gap-3 px-8">
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
					<div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
						<p class="text-[0.875rem] text-white/70">{"No matching projects found"}</p>
						<p class="max-w-[320px] text-[0.8125rem] text-white/45">
							{"Go back to adjust your agent selection, or skip — you can import projects anytime."}
						</p>
					</div>
				{:else}
					<div class="min-h-0 flex-1 overflow-y-auto rounded-xl bg-white/[0.02]">
						<ProjectTable
							projects={filteredProjects}
							loading={onboardingProjectsLoading}
							addedPaths={onboardingAddedPaths}
							selectedAgentIds={onboardingSelectedAgents}
							onImport={handleOnboardingImport}
						/>
					</div>
				{/if}
			</div>

			<!-- Footer. No top border — we use whitespace + a soft inset surface to delineate. -->
			<div class="flex items-center justify-between px-8 pt-6 pb-8">
				<Button
					variant="ghost"
					size="sm"
					class="h-9 rounded-lg px-3 text-[0.8125rem] text-white/55 hover:bg-white/[0.04] hover:text-white"
					onclick={() => (onboardingStep = "agents")}
				>
					{"Back"}
				</Button>
				<div class="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						class="h-9 rounded-lg px-3 text-[0.8125rem] text-white/55 hover:bg-white/[0.04] hover:text-white"
						onclick={() => finishOnboarding()}
					>
						{"Skip for now"}
					</Button>
					<Button
						variant="default"
						size="lg"
						class="h-9 gap-2 rounded-xl bg-primary px-5 text-[0.9375rem] font-medium text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_10px_24px_-12px_rgba(0,0,0,0.55)] hover:bg-primary/92"
						onclick={() => finishOnboarding()}
					>
						<span>{"Finish"}</span>
						<ArrowRight weight="bold" class="size-4" />
					</Button>
				</div>
			</div>
		</div>
	{:else}
		<!-- Scanning — unframed. -->
		<div class="flex flex-col items-center gap-4">
			<Spinner class="h-7 w-7 text-white/70" />
			<p class="text-[0.875rem] text-white/55">{onboardingBusyMessage || "Loading…"}</p>
		</div>
	{/if}
	{/key}
</div>

<style>
	/*
	 * One calm opacity breath on mount — and re-fires on each step change
	 * because the content is wrapped in {#key onboardingStep}. No fly, no stagger.
	 */
	.onboarding-card {
		position: relative;
		box-shadow:
			0 30px 60px -18px rgba(0, 0, 0, 0.55),
			0 14px 28px -18px rgba(0, 0, 0, 0.45);
		animation: onboarding-fade 280ms ease-out both;
	}

	@keyframes onboarding-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/*
	 * Progress pills. Three short dashes beneath the wordmark.
	 * Honest progression — no numbers, no percentages, no marketing gloss.
	 */
	.progress-pill {
		display: block;
		height: 2px;
		width: 1.25rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		transition:
			background-color 220ms ease,
			width 220ms ease;
	}

	.progress-pill--done {
		background: rgba(255, 255, 255, 0.28);
	}

	.progress-pill--active {
		width: 1.75rem;
		background: rgba(240, 238, 230, 0.9);
	}

	/*
	 * Agent icons. Monochrome at rest so no single brand color competes with
	 * the selection state. On selection, the filter is dropped and the icon
	 * renders in its native brand color — orange for Claude, etc.
	 */
	:global(.agent-icon) {
		transition:
			filter 200ms ease,
			opacity 200ms ease;
	}

	:global(.agent-icon--monochrome) {
		filter: grayscale(1) brightness(1.15);
		opacity: 0.72;
	}

	:global(.agent-card:hover .agent-icon--monochrome) {
		filter: grayscale(0) brightness(1);
		opacity: 0.95;
	}

	/*
	 * Keycap. Real physical feel via stacked inset shadows — no border.
	 */
	:global(.onboarding-surface .keycap) {
		display: inline-flex;
		height: 1.25rem;
		min-width: 1.25rem;
		align-items: center;
		justify-content: center;
		padding: 0 0.375rem;
		border-radius: 0.3125rem;
		background: rgba(255, 255, 255, 0.045);
		color: rgba(255, 255, 255, 0.72);
		font-family:
			ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
		font-size: 0.6875rem;
		line-height: 1;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			inset 0 -1px 0 rgba(0, 0, 0, 0.45);
	}

	/*
	 * Agent card. No border. Surface is a low-opacity white wash.
	 * A cursor-following spotlight replaces the usual hover tint — signature
	 * JetBrains/Linear affordance, costs almost nothing, feels tactile.
	 */
	:global(.agent-card) {
		background: rgba(255, 255, 255, 0.025);
		transition:
			background-color 200ms ease,
			transform 200ms ease;
	}

	:global(.agent-card:hover) {
		background: rgba(255, 255, 255, 0.06);
	}

	:global(.agent-card--selected) {
		background: rgba(240, 238, 230, 0.08);
	}

	:global(.agent-card:focus-visible) {
		outline: none;
		box-shadow: 0 0 0 2px rgba(240, 238, 230, 0.55);
	}
</style>
