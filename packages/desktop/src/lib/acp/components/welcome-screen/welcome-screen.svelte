<script lang="ts">
import { BrandSurface, HugeiconsIcon } from "@acepe/ui";
import { ResultAsync } from "neverthrow";
import { onDestroy, onMount } from "svelte";
import { toast } from "svelte-sonner";
import AgentErrorCard from "$lib/acp/components/agent-panel/components/agent-error-card.svelte";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { getErrorCauseDetails } from "$lib/acp/errors/error-cause-details.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { Button } from "$lib/components/ui/button/index.js";
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
import { BrandThemeToggle } from "$lib/components/theme/index.js";
import { getOnboardingSelectableAgents } from "./onboarding-agent-discovery.js";
import {
	AGENT_VENDORS,
	type OnboardingStep,
	extractNameFromPath,
	filterProjectsBySelectedAgents,
	toggleSelectedOnboardingAgent,
} from "./welcome-screen-state.js";
import type { WelcomeScreenProps } from "./welcome-screen-props.js";

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
let onboardingPreviewFrame = $state(0);
let onboardingPreviewInterval: ReturnType<typeof setInterval> | null = null;

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const ONBOARDING_PREVIEW_REST_FRAMES = 2;

const onboardingPreviewAgents = [
	{
		id: "claude-code",
		label: "Claude",
		state: "streaming",
		phaseOffsetFrames: 0,
		timeline: [
			{ type: "message", text: "I found the onboarding surface." },
			{ type: "tool", kind: "search", title: "Search", detail: "welcome-screen" },
			{ type: "message", text: "Reading the project picker component." },
			{ type: "tool", kind: "read", title: "Read", detail: "project-table.svelte" },
			{ type: "message", text: "I'll map the flow before editing." },
			{ type: "tool", kind: "task", title: "Task", detail: "Plan onboarding changes" },
			{ type: "message", text: "Next: update the copy and spacing." },
		],
		composer: "Ask for tradeoffs",
	},
	{
		id: "codex",
		label: "Codex",
		state: "tool",
		phaseOffsetFrames: 2,
		timeline: [
			{ type: "message", text: "I can reproduce the preview issue." },
			{ type: "tool", kind: "browser", title: "Browser", detail: "Inspect onboarding" },
			{ type: "message", text: "The fake rows are coming from local data." },
			{ type: "tool", kind: "read", title: "Read", detail: "welcome-screen.svelte" },
			{ type: "message", text: "I'll replace them with tool-call rows." },
			{ type: "tool", kind: "execute", title: "Run", detail: "bun run check" },
			{ type: "message", text: "Then I'll verify the live WebView." },
		],
		composer: "Run visual QA",
	},
	{
		id: "cursor",
		label: "Cursor",
		state: "edit",
		phaseOffsetFrames: 4,
		timeline: [
			{ type: "message", text: "Applying the UI patch now." },
			{ type: "tool", kind: "edit", title: "Edit File", detail: "welcome-screen.svelte" },
			{
				type: "diff",
				lines: [
					"- staticToolRows={previewRows}",
					"+ timeline={canonicalEvents}",
					'+ title="Edit File"',
				],
			},
			{ type: "message", text: "Keeping the component surface small." },
			{ type: "tool", kind: "execute", title: "Run", detail: "bun run check" },
			{ type: "message", text: "Ready for a live visual pass." },
			{ type: "tool", kind: "browser", title: "Browser", detail: "Capture screenshot" },
		],
		composer: "Adjust the layout",
	},
] satisfies readonly {
	readonly id: string;
	readonly label: string;
	readonly state: "streaming" | "tool" | "edit";
	readonly phaseOffsetFrames: number;
	readonly timeline: readonly (
		| {
				readonly type: "message";
				readonly text: string;
		  }
		| {
				readonly type: "tool";
				readonly kind: "browser" | "edit" | "execute" | "read" | "search" | "task";
				readonly title: string;
				readonly detail: string;
		  }
		| {
				readonly type: "diff";
				readonly lines: readonly string[];
		  }
	)[];
	readonly composer: string;
}[];
const onboardingAvailableAgents = $derived(getOnboardingSelectableAgents(agentStore.agents));
const filteredProjects = $derived(
	filterProjectsBySelectedAgents(onboardingProjects, onboardingSelectedAgents)
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

function getOnboardingPreviewFrame(phaseOffsetFrames: number, timelineLength: number): number {
	const cycleLength = timelineLength + ONBOARDING_PREVIEW_REST_FRAMES;
	return (onboardingPreviewFrame + phaseOffsetFrames) % cycleLength;
}

function isOnboardingTimelineEventVisible(index: number, frame: number): boolean {
	return frame > index;
}

function isOnboardingTimelineEventActive(index: number, frame: number): boolean {
	return frame === index + 1;
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
	onboardingSelectedAgents = toggleSelectedOnboardingAgent(onboardingSelectedAgents, agentId);
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

async function handleOnboardingUndoImport(path: string, name: string) {
	if (!onboardingAddedPaths.has(path)) {
		return;
	}

	const result = await tauriClient.projects.removeProject(path);
	result.match(
		() => {
			const nextAddedPaths = new Set(onboardingAddedPaths);
			nextAddedPaths.delete(path);
			onboardingAddedPaths = nextAddedPaths;
			toast.success(`${name} removed from repositories`);
		},
		(error) => {
			toast.error(error.message);
		}
	);
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
	onboardingPreviewInterval = setInterval(() => {
		onboardingPreviewFrame = onboardingPreviewFrame + 1;
	}, 950);
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeydown);
	if (onboardingPreviewInterval !== null) {
		clearInterval(onboardingPreviewInterval);
		onboardingPreviewInterval = null;
	}
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

<!-- Content layer. Full onboarding page sharing the brand surface shell. -->
<BrandSurface class="onboarding-surface">
	{#snippet topRight()}
		<BrandThemeToggle />
	{/snippet}

	{#key onboardingStep}
	{#if onboardingStep === "splash"}
		<div
			class="onboarding-card flex w-full max-w-[680px] flex-col overflow-hidden rounded-xl bg-card text-card-foreground"
		>
			<section class="onboarding-hero-card relative isolate overflow-hidden px-5 py-5 sm:px-6">
				<div class="relative z-10 flex flex-col gap-4">
					<h1 class="text-[2.45rem] font-medium leading-[1.02] tracking-tight text-foreground sm:text-[3rem]">
						{"Welcome to Acepe"}
					</h1>
					<p class="max-w-[34rem] text-[0.975rem] leading-[1.6] text-muted-foreground">
						{"Set up your agent workspace in a minute. We'll help you choose agents, find existing projects, and get everything ready in one place."}
					</p>
					<div class="onboarding-preview overflow-hidden rounded-lg p-1.5">
						<div class="grid min-h-[248px] grid-cols-3 gap-0.5">
							{#each onboardingPreviewAgents as agent (agent.id)}
								{@const previewFrame = getOnboardingPreviewFrame(agent.phaseOffsetFrames, agent.timeline.length)}
								<div class="onboarding-preview-panel relative flex flex-col overflow-hidden rounded-md bg-background/70 px-1 py-1">
									<div class="mb-2 flex items-center justify-between gap-1.5">
										<div class="flex min-w-0 items-center gap-1.5">
											{#if agent.id === "claude-code"}
												<span
													class="size-3.5 shrink-0 bg-[#D97757]"
													style="-webkit-mask: url('/svgs/icons/claude.svg') center / contain no-repeat; mask: url('/svgs/icons/claude.svg') center / contain no-repeat;"
												></span>
											{:else if agent.id === "codex"}
												<img
													src="/svgs/agents/codex/codex-icon-light.svg"
													alt=""
													class="size-3.5 shrink-0 object-contain dark:hidden"
												/>
												<img
													src="/svgs/agents/codex/codex-icon-dark.svg"
													alt=""
													class="hidden size-3.5 shrink-0 object-contain dark:block"
												/>
											{:else}
												<img src="/svgs/icons/cursor.svg" alt="" class="size-3.5 shrink-0" />
											{/if}
											<div class="truncate text-[10px] font-medium text-muted-foreground">{agent.label}</div>
										</div>
									</div>
									<div class="onboarding-preview-transcript flex min-h-0 flex-1 flex-col gap-1.5 p-px">
										<div class="onboarding-preview-timeline flex min-h-0 flex-1 flex-col gap-1">
											{#each agent.timeline as event, index (event.type === "message" ? event.text : event.type === "tool" ? event.title + event.detail : event.lines[0])}
												{#if isOnboardingTimelineEventVisible(index, previewFrame)}
													{#if event.type === "message"}
														<p
															class="onboarding-preview-timeline-entry m-0 truncate text-[9px] leading-[1.35] text-muted-foreground/85 {isOnboardingTimelineEventActive(index, previewFrame)
																? 'onboarding-preview-stream-line'
																: ''}"
														>
															{event.text}
														</p>
													{:else if event.type === "tool"}
														<div
															class="onboarding-preview-timeline-entry onboarding-preview-tool-row flex min-w-0 items-center gap-1.5 rounded-[5px] bg-card/80 px-1.5 py-1 {isOnboardingTimelineEventActive(index, previewFrame)
																? 'onboarding-preview-reveal'
																: ''}"
														>
															<span class="shrink-0 text-[8px] font-medium leading-none text-muted-foreground/90">
																{event.title}
															</span>
															<span class="min-w-0 truncate text-[8px] leading-none text-muted-foreground/50">
																{event.detail}
															</span>
														</div>
													{:else}
														<div
															class="onboarding-preview-timeline-entry onboarding-preview-diff rounded-[5px] bg-card/80 px-1.5 py-1.5 {isOnboardingTimelineEventActive(index, previewFrame)
																? 'onboarding-preview-reveal'
																: ''}"
														>
															{#each event.lines as line (line)}
																<div
																	class="truncate font-mono text-[8px] leading-none {line.startsWith('+')
																		? 'text-[#72D58A]'
																		: line.startsWith('-')
																			? 'text-[#D97757]'
																			: 'text-muted-foreground/70'}"
																>
																	{line}
																</div>
															{/each}
														</div>
													{/if}
												{/if}
											{/each}
										</div>

										<div class="mt-auto flex flex-col gap-1">
											{#if agent.state !== "edit"}
												<div class="onboarding-preview-shimmer truncate text-[9px] font-medium leading-none">
													Planning next moves
												</div>
											{/if}
											<div class="onboarding-preview-composer flex items-center gap-1 rounded-[5px] bg-card/80 px-1 py-1">
												<span class="truncate pl-0.5 text-[8px] leading-none text-muted-foreground/45">
													{agent.composer}
												</span>
												<span class="ml-auto inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] bg-foreground/10 text-muted-foreground">
													<HugeiconsIcon
														name="paper-plane"
														class="size-2.5"
														data-testid="welcome-paper-plane-icon"
													/>
												</span>
											</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			</section>

			<!-- CTA row. Clean card surface under the grain header. -->
			<div class="flex justify-end px-5 py-5 sm:px-6">
				<Button
					variant="default"
					class="group"
					onclick={advanceFromSplash}
				>
					<span>{"Get started"}</span>
					<span class="onboarding-button-arrow inline-flex size-4">
						<HugeiconsIcon name="arrow-right" class="size-full" data-testid="welcome-arrow-right-icon" />
					</span>
				</Button>
			</div>
		</div>
	{:else if onboardingStep === "agents"}
		<div
			class="onboarding-card flex w-full max-w-[680px] flex-col overflow-hidden rounded-xl bg-card text-card-foreground"
		>
			<section class="onboarding-hero-card relative isolate overflow-hidden px-5 py-5 sm:px-6">
				<div class="relative z-10 flex flex-col gap-4">
					<h2 class="text-[2.45rem] font-medium leading-[1.02] tracking-tight text-foreground sm:text-[3rem]">
						{"Choose your agents"}
					</h2>
					<p class="max-w-[34rem] text-[0.975rem] leading-[1.6] text-muted-foreground">
						{"Pick the agents you work with. We'll surface projects where you've used them."}
					</p>
				</div>
			</section>

			<div class="flex flex-col gap-4 px-5 py-5 sm:px-6">
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{#each onboardingAvailableAgents as agent (agent.id)}
						{@const isSelected = onboardingSelectedAgents.includes(agent.id)}
						{@const vendor = AGENT_VENDORS[agent.id] ?? ""}
						<button
							type="button"
							aria-pressed={isSelected}
							aria-label={agent.name}
							onclick={() => toggleOnboardingAgent(agent.id)}
							class="agent-choice group flex h-11 items-center justify-between gap-3 rounded-md px-3 text-left {isSelected
								? 'agent-choice--selected'
								: ''}"
						>
							<span class="flex min-w-0 items-center gap-2.5">
								<AgentIcon
									agentId={agent.id}
									providerBrand={agent.providerMetadata?.providerBrand ?? null}
									providerLabel={agent.providerMetadata?.displayName ?? agent.name}
									size={16}
									class="agent-icon {isSelected ? '' : 'agent-icon--monochrome'}"
								/>
								<span class="flex min-w-0 flex-col gap-0.5">
									<span class="truncate text-[0.8125rem] font-medium leading-tight text-foreground">
										{agent.name}
									</span>
									{#if vendor}
										<span class="truncate text-[0.6875rem] leading-tight text-muted-foreground">
											{vendor}
										</span>
									{/if}
								</span>
							</span>
							{#if isSelected}
								<span class="agent-choice-indicator text-foreground">
									<HugeiconsIcon
										name="check-circle-filled"
										class="size-full"
										data-testid="welcome-agent-check-icon"
									/>
								</span>
							{:else}
								<span class="agent-choice-indicator text-muted-foreground/45">
									<HugeiconsIcon
										name="unselected"
										class="size-full"
										data-testid="welcome-agent-unselected-icon"
									/>
								</span>
							{/if}
						</button>
					{/each}
				</div>

				<div class="flex items-center justify-between">
					<span class="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
						{#if onboardingSelectedAgents.length === 0}
							<span>{"Select at least one agent"}</span>
						{:else}
							<span>{`${onboardingSelectedAgents.length} selected`}</span>
						{/if}
					</span>
					<Button
						variant="default"
						class="group"
						disabled={onboardingSelectedAgents.length === 0}
						onclick={() => (onboardingStep = "projects")}
					>
						<span>{"Continue"}</span>
						<span class="onboarding-button-arrow inline-flex size-4">
							<HugeiconsIcon name="arrow-right" class="size-full" data-testid="welcome-arrow-right-icon" />
						</span>
					</Button>
				</div>
			</div>
		</div>
	{:else if onboardingStep === "projects"}
		<div
			class="onboarding-card flex max-h-[min(720px,calc(100vh-8rem))] w-full max-w-[680px] flex-col overflow-hidden rounded-xl bg-card text-card-foreground"
		>
			<section class="onboarding-hero-card relative isolate overflow-hidden px-5 py-5 sm:px-6">
				<div class="relative z-10 flex flex-col gap-4">
					<h2 class="text-[2.45rem] font-medium leading-[1.02] tracking-tight text-foreground sm:text-[3rem]">
						{"Import your projects"}
					</h2>
					<p class="max-w-[34rem] text-[0.975rem] leading-[1.6] text-muted-foreground">
						{"We found projects with agent sessions. Add the ones you want in Acepe, or skip and import later."}
					</p>
				</div>
			</section>

			<div class="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5 sm:px-6">
				{#if onboardingImportError}
					<AgentErrorCard
						title={onboardingImportError.title}
						summary={onboardingImportError.summary}
						details={onboardingImportError.details}
						onDismiss={() => {
							onboardingImportError = null;
							onboardingImportProjectPath = null;
							onboardingImportProjectName = null;
						}}
						issueActionLabel={onboardingIssueDraft
							? resolveIssueActionLabel(onboardingIssueDraft)
							: "Create issue"}
						onIssueAction={onboardingIssueDraft ? handleOnboardingIssueAction : undefined}
					/>
				{/if}
				{#if filteredProjects.length === 0 && !onboardingProjectsLoading}
					<div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
						<p class="text-[0.875rem] text-foreground/80">{"No matching projects found"}</p>
						<p class="max-w-[320px] text-[0.8125rem] text-muted-foreground">
							{"Go back to adjust your agent selection, or skip — you can import projects anytime."}
						</p>
					</div>
				{:else}
					<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
						<ProjectTable
							projects={filteredProjects}
							loading={onboardingProjectsLoading}
							addedPaths={onboardingAddedPaths}
							selectedAgentIds={onboardingSelectedAgents}
							onImport={handleOnboardingImport}
							onUndo={handleOnboardingUndoImport}
						/>
					</div>
				{/if}

				<div class="flex items-center justify-between">
					<Button
						variant="ghost"
						size="sm"
						onclick={() => (onboardingStep = "agents")}
					>
						{"Back"}
					</Button>
					<div class="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onclick={() => finishOnboarding()}
						>
							{"Skip for now"}
						</Button>
						<Button
							variant="default"
							class="group"
							onclick={() => finishOnboarding()}
						>
							<span>{"Start building"}</span>
							<span class="onboarding-button-arrow inline-flex size-4">
								<HugeiconsIcon name="arrow-right" class="size-full" data-testid="welcome-arrow-right-icon" />
							</span>
						</Button>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- Scanning — unframed. -->
		<div class="flex flex-col items-center gap-4">
			<Spinner class="text-muted-foreground" size={28} />
			<p class="text-[0.875rem] text-muted-foreground">{onboardingBusyMessage || "Loading…"}</p>
		</div>
	{/if}
	{/key}
</BrandSurface>

<style>
	.onboarding-card {
		position: relative;
		box-shadow: none;
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

	:global(.agent-choice:hover .agent-icon--monochrome) {
		filter: grayscale(0) brightness(1);
		opacity: 0.95;
	}

	:global(.agent-choice) {
		background: color-mix(in srgb, var(--muted) 58%, transparent);
		transition:
			background-color 200ms ease,
			color 200ms ease,
			box-shadow 200ms ease;
	}

	:global(.agent-choice:hover) {
		background: var(--accent);
	}

	:global(.agent-choice--selected) {
		background: color-mix(in srgb, var(--primary) 12%, var(--card) 88%);
	}

	:global(.agent-choice:focus-visible) {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 72%, transparent);
	}

	.agent-choice-indicator {
		display: block;
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		transition:
			color 200ms ease,
			transform 200ms ease;
	}

	.agent-choice--selected .agent-choice-indicator {
		transform: scale(1.04);
	}

	.onboarding-preview-panel {
		min-height: 227px;
	}

	.onboarding-preview-timeline,
	.onboarding-preview-timeline-entry,
	.onboarding-preview-tool,
	.onboarding-preview-diff,
	.onboarding-preview-composer {
		position: relative;
	}

	.onboarding-preview-stream-line {
		clip-path: inset(0 100% 0 0);
		overflow: hidden;
		white-space: nowrap;
		animation: onboarding-preview-stream-reveal 720ms steps(28, end) forwards;
		animation-fill-mode: both;
		will-change: clip-path;
	}

	.onboarding-preview-reveal {
		opacity: 0;
		animation: onboarding-preview-entry-reveal 180ms ease-out forwards;
		animation-fill-mode: both;
	}

	.onboarding-preview-shimmer {
		width: fit-content;
		max-width: 100%;
		color: transparent;
		background:
			linear-gradient(
				100deg,
				color-mix(in srgb, var(--muted-foreground) 45%, transparent) 0%,
				color-mix(in srgb, var(--foreground) 74%, transparent) 45%,
				color-mix(in srgb, var(--muted-foreground) 45%, transparent) 90%
			);
		background-size: 220% 100%;
		background-clip: text;
		-webkit-background-clip: text;
		animation: onboarding-preview-shimmer 2.8s ease-in-out infinite;
	}

	.onboarding-button-arrow {
		transform: translateX(0);
		transition: transform 200ms ease-out;
	}

	:global(.group:hover) .onboarding-button-arrow,
	:global(.group:focus-visible) .onboarding-button-arrow {
		transform: translateX(0.125rem);
	}

	@keyframes onboarding-preview-stream-reveal {
		0% {
			clip-path: inset(0 100% 0 0);
		}

		100% {
			clip-path: inset(0 0 0 0);
		}
	}

	@keyframes onboarding-preview-entry-reveal {
		0% {
			opacity: 0;
		}

		100% {
			opacity: 1;
		}
	}

	@keyframes onboarding-preview-shimmer {
		0%,
		100% {
			background-position: 120% 0;
		}

		50% {
			background-position: 0 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.onboarding-preview-stream-line {
			animation: none;
			clip-path: inset(0 0 0 0);
		}

		.onboarding-preview-reveal {
			animation: none;
			opacity: 1;
		}

		.onboarding-preview-shimmer {
			animation: none;
		}
	}
</style>
