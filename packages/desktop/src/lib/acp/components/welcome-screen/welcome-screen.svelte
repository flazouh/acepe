<script lang="ts">
import { ArrowRightIcon, PillButton } from "@acepe/ui";
import {
	GrainGradientShapes,
	type GrainGradientUniforms,
	getShaderColorFromString,
	getShaderNoiseTexture,
	grainGradientFragmentShader,
	ShaderFitOptions,
	ShaderMount,
} from "@paper-design/shaders";
import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import { onDestroy, onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { AgentCard } from "$lib/acp/components/agent-card/index.js";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import { getAgentIcon } from "$lib/acp/constants/thread-list-constants.js";
import { getAgentPreferencesStore, getAgentStore } from "$lib/acp/store/index.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/paraglide/messages.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import logo from "../../../../../../../assets/logo.svg?url";
import type { ProjectWithSessions } from "../add-repository/open-project-dialog-props.js";

import ProjectTable from "../add-repository/project-table.svelte";
import type { WelcomeScreenProps } from "./welcome-screen-props.js";

const SPLASH_AGENTS: { id: string; alt: string }[] = [
	{ id: "claude-code", alt: "Claude" },
	{ id: "codex", alt: "Codex" },
	{ id: "cursor", alt: "Cursor" },
	{ id: "opencode", alt: "OpenCode" },
];

type OnboardingStep = "splash" | "agents" | "projects" | "scanning";

let { onProjectImported, onDismiss }: WelcomeScreenProps = $props();

let onboardingStep = $state<OnboardingStep>("splash");
let onboardingProjectsLoading = $state(false);
let onboardingProjects = $state<ProjectWithSessions[]>([]);
let onboardingAddedPaths = $state<Set<string>>(new Set());
let onboardingSelectedAgents = $state<string[]>([]);
let onboardingBusyMessage = $state("");
let shaderContainer: HTMLDivElement | null = $state(null);
let shaderMountRef: ShaderMount | null = null;

const agentStore = getAgentStore();
const agentPreferencesStore = getAgentPreferencesStore();
const themeState = useTheme();
const theme = $derived(themeState.effectiveTheme);
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
	const installed = agentStore.agents.filter((agent) => agent.available).map((agent) => agent.id);
	if (installed.length > 0) {
		return installed;
	}
	return agentStore.agents.map((agent) => agent.id);
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

	const result = await ResultAsync.fromPromise(
		invoke("import_project", { path, name }),
		(error) => new Error(`Failed to import project: ${error}`)
	)
		.map(() => {
			onboardingAddedPaths = new Set([...onboardingAddedPaths, path]);
			toast.success(m.open_project_added_toast({ name }));
		})
		.mapErr((error) => {
			toast.error(error.message);
		});

	if (result.isOk()) {
		onProjectImported(path, name);
	}
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
			for (const info of projectInfos) {
				if (info.path === "/" || info.path === "global") continue;
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
						onboardingProjects = onboardingProjects.map((project) =>
							project.path === path
								? {
										...project,
										agentCounts: new Map(
											Object.entries(counts.counts).map(([agentId, count]) => [agentId, count])
										),
										totalSessions: total,
									}
								: project
						);
					},
					() => {
						onboardingProjects = onboardingProjects.map((project) =>
							project.path === path ? { ...project, totalSessions: "error" } : project
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

async function initShader() {
	if (!shaderContainer) return;

	try {
		const noiseTexture = getShaderNoiseTexture();

		if (noiseTexture && !noiseTexture.complete) {
			await new Promise<void>((resolve, reject) => {
				noiseTexture.onload = () => resolve();
				noiseTexture.onerror = () => reject(new Error("Failed to load shader noise texture"));
			});
		}

		const containerWidth = shaderContainer.offsetWidth;
		const containerHeight = shaderContainer.offsetHeight;

		shaderMountRef = new ShaderMount(
			shaderContainer,
			grainGradientFragmentShader,
			{
				u_colorBack: getShaderColorFromString("#1a1a1a"),
				u_colors: [
					getShaderColorFromString("#F77E2C"),
					getShaderColorFromString("#ff8558"),
					getShaderColorFromString("#d69d5c"),
					getShaderColorFromString("#ffb380"),
				],
				u_colorsCount: 4,
				u_softness: 0.3,
				u_intensity: 0.8,
				u_noise: 0.15,
				u_shape: GrainGradientShapes.corners,
				u_noiseTexture: noiseTexture,
				u_fit: ShaderFitOptions.cover,
				u_scale: 1,
				u_rotation: 0,
				u_originX: 0.5,
				u_originY: 0.5,
				u_offsetX: 0,
				u_offsetY: 0,
				u_worldWidth: containerWidth,
				u_worldHeight: containerHeight,
			} satisfies Partial<GrainGradientUniforms>,
			{ alpha: false, premultipliedAlpha: false },
			0.5
		);
	} catch (error) {
		console.error("[WelcomeScreen] Failed to initialize shader:", error);
	}
}

onMount(() => {
	window.addEventListener("keydown", handleKeydown);
	initShader();
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeydown);
	shaderMountRef?.dispose();
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
<div class="absolute inset-0 bg-[#1a1a1a]">
	<div bind:this={shaderContainer} class="absolute inset-0"></div>
</div>

<!-- Content layer -->
<div
	class="relative z-10 flex flex-col items-center justify-center h-full w-full max-w-4xl mx-auto px-6 py-12"
>
	{#if onboardingStep === "splash"}
		<!-- Splash: 16:9 card with welcome message -->
		<div
			class="flex flex-col rounded-2xl bg-background/80 p-8 w-[640px] aspect-video"
		>
			<!-- Top Left: Logo + Label -->
			<div class="flex items-center gap-3">
				<img src={logo} alt="Acepe Logo" class="w-8 h-8" />
				<span class="text-lg font-semibold tracking-wider text-foreground">ACEPE</span>
			</div>

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
				<PillButton variant="primary" onclick={advanceFromSplash}>
					{#snippet trailingIcon()}
						<ArrowRightIcon size="lg" />
					{/snippet}
					{m.splash_enter()}
				</PillButton>
			</div>
		</div>
	{:else}
		<!-- Agents / Projects / Scanning steps -->
		<div class="flex items-center gap-3 mb-8">
			<img src={logo} alt="Acepe Logo" class="w-10 h-10" />
			<h1 class="font-sans font-semibold text-3xl tracking-tight text-foreground">ACEPE</h1>
		</div>

		<div
			class="w-full max-w-3xl border border-border/50 rounded-xl bg-background p-6"
		>
			{#if onboardingStep === "agents"}
				<div class="space-y-6">
					<div class="text-center space-y-2">
						<h2 class="text-2xl font-semibold">{m.welcome_choose_agents()}</h2>
						<p class="text-sm text-muted-foreground">
							{m.welcome_agents_description()}
						</p>
					</div>

					<div class="grid grid-cols-2 gap-4 w-fit mx-auto">
						{#each agentStore.agents as agent (agent.id)}
							<AgentCard
								agentId={agent.id}
								agentName={agent.name}
								iconSrc={getAgentIcon(agent.id, theme)}
								isSelected={onboardingSelectedAgents.includes(agent.id)}
								isAvailable={agent.available}
								onclick={() => toggleOnboardingAgent(agent.id)}
							/>
						{/each}
					</div>

					<div class="flex justify-end gap-3">
						<PillButton
							variant="primary"
							disabled={onboardingSelectedAgents.length === 0}
							onclick={() => (onboardingStep = "projects")}
						>
							{#snippet trailingIcon()}
								<ArrowRightIcon size="lg" />
							{/snippet}
							{m.welcome_continue()}
						</PillButton>
					</div>
				</div>
			{:else if onboardingStep === "projects"}
				<div class="space-y-4">
					<div class="text-center space-y-2">
						<h2 class="text-2xl font-semibold">{m.welcome_onboarding_select_projects()}</h2>
						<p class="text-sm text-muted-foreground">
							{m.welcome_onboarding_select_projects_description()}
						</p>
					</div>

					{#if filteredProjects.length === 0 && !onboardingProjectsLoading}
						<div class="flex flex-col items-center justify-center py-12 text-center space-y-3">
							<p class="text-sm text-muted-foreground">{m.onboarding_projects_no_match()}</p>
							<p class="text-xs text-muted-foreground/70">
								{m.onboarding_projects_change_agents()}
							</p>
						</div>
					{:else}
						<div class="max-h-[320px] overflow-y-auto">
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
						<PillButton variant="outline" onclick={() => (onboardingStep = "agents")}>
							{m.common_back()}
						</PillButton>
						<div class="flex gap-3">
							<PillButton variant="ghost" onclick={() => finishOnboarding()}>
								{m.welcome_skip_for_now()}
							</PillButton>
							<PillButton variant="primary" onclick={() => finishOnboarding()}>
								{#snippet trailingIcon()}
									<ArrowRightIcon size="lg" />
								{/snippet}
								{m.welcome_finish()}
							</PillButton>
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
