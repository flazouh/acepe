<script lang="ts">
import { DiffPill } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import ArrowsOut from "phosphor-svelte/lib/ArrowsOut";
import Check from "phosphor-svelte/lib/Check";
import Cpu from "phosphor-svelte/lib/Cpu";
import DotsThreeVertical from "phosphor-svelte/lib/DotsThreeVertical";
import FileCode from "phosphor-svelte/lib/FileCode";
import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
import NotePencil from "phosphor-svelte/lib/NotePencil";
import Robot from "phosphor-svelte/lib/Robot";
import SidebarSimple from "phosphor-svelte/lib/SidebarSimple";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/paraglide/messages.js";
import type { Model } from "../../application/dto/model.js";
import { getAgentIcon } from "../../constants/thread-list-constants.js";
import type { AgentInfo } from "../../logic/agent-manager.js";
import * as agentModelPrefs from "../../store/agent-model-preferences-store.svelte.js";
import { getReviewPreferenceStore } from "../../store/review-preference-store.svelte.js";
import { sessionReviewStateStore } from "../../store/session-review-state-store.svelte.js";
import { capitalizeName } from "../../utils/string-formatting.js";
import { getModelDisplayName } from "../model-selector-logic.js";
import AnimatedChevron from "../animated-chevron.svelte";
import type { FileReviewStatus } from "../review-panel/review-session-state.js";
import InlineModifiedFileRow from "./components/inline-modified-file-row.svelte";
import {
	buildPrGenerationPrefsForAgentSelection,
	buildPrGenerationRequestConfig,
	getValidPrGenerationModelId,
} from "./logic/pr-generation-preferences.js";
import { getReviewStatusByFilePath } from "./logic/review-progress.js";
import type { ModifiedFilesState } from "./types/modified-files-state.js";

/**
 * Configuration for the agent and model to use when generating PR content.
 */
export interface PrGenerationConfig {
	agentId?: string;
	modelId?: string;
	/** User-provided instructions that replace the default prompt template. */
	customPrompt?: string;
}

/**
 * Props for ModifiedFilesHeader.
 * Receives pre-computed modifiedFilesState from parent (avoids duplicate aggregateFileEdits calls).
 */
interface Props {
	/** Pre-computed modified files state from parent */
	modifiedFilesState: ModifiedFilesState | null;
	/** Session identity used for per-session review progress persistence */
	sessionId?: string | null;
	/** Called when Review button is clicked - enters panel review mode */
	onEnterReviewMode?: (modifiedFilesState: ModifiedFilesState, fileIndex: number) => void;
	/** Optional: when provided, shows expand icon to open full-screen review overlay */
	onOpenFullscreenReview?: (modifiedFilesState: ModifiedFilesState, fileIndex: number) => void;
	/** Optional: when provided, shows Create PR pill button */
	onCreatePr?: (config?: PrGenerationConfig) => void;
	/** Disables the Create PR button when true (e.g. while request in flight) */
	createPrLoading?: boolean;
	/** Label to display on the Create PR button during loading (e.g. "Staging...", "Pushing...") */
	createPrLabel?: string | null;
	/** Available agents for PR generation selection */
	availableAgents?: AgentInfo[];
	/** Current/default agent ID for PR generation */
	currentAgentId?: string | null;
	/** Current/default model ID for PR generation */
	currentModelId?: string | null;
	/** Current effective theme */
	effectiveTheme?: "light" | "dark";
}

let {
	modifiedFilesState,
	sessionId = null,
	onEnterReviewMode,
	onOpenFullscreenReview,
	onCreatePr,
	createPrLoading = false,
	createPrLabel = null,
	availableAgents = [],
	currentAgentId = null,
	currentModelId = null,
	effectiveTheme = "dark",
}: Props = $props();

// Get review preference store at component initialization (not in handlers)
const reviewPreferenceStore = getReviewPreferenceStore();

let isExpanded = $state(false);
let showPromptEditor = $state(false);

// PR generation preferences — persisted globally via SQLite
const prPrefs = $derived(agentModelPrefs.getPrGenerationPrefs());

// Derived effective values (persisted override > current default)
const effectiveAgentId = $derived(prPrefs.agentId ? prPrefs.agentId : currentAgentId);

// Models react to the effective agent selection — when the user picks a
// different agent in the dropdown the model list updates automatically.
const reactiveModels = $derived(
	effectiveAgentId ? agentModelPrefs.getCachedModels(effectiveAgentId) : []
);
const selectedModelId = $derived(getValidPrGenerationModelId(prPrefs.modelId, reactiveModels));
const effectiveModelId = $derived(selectedModelId ? selectedModelId : currentModelId);

const effectiveAgent = $derived.by((): AgentInfo | null => {
	if (!effectiveAgentId) return null;
	const found = availableAgents.find((a) => a.id === effectiveAgentId);
	return found ? found : null;
});
const effectiveModel = $derived.by((): Model | null => {
	if (!effectiveModelId) return null;
	const found = reactiveModels.find((mdl) => mdl.id === effectiveModelId);
	return found ? found : null;
});

const effectiveModelDisplayName = $derived.by(() => {
	if (!effectiveModel) return "Default";
	return getModelDisplayName(effectiveModel, effectiveAgentId);
});

const totalAdded = $derived(
	modifiedFilesState ? modifiedFilesState.files.reduce((sum, f) => sum + f.totalAdded, 0) : 0
);

const totalRemoved = $derived(
	modifiedFilesState ? modifiedFilesState.files.reduce((sum, f) => sum + f.totalRemoved, 0) : 0
);

const reviewStatusByFilePath = $derived.by(
	(): ReadonlyMap<string, FileReviewStatus | undefined> => {
		if (!modifiedFilesState) return new Map<string, FileReviewStatus | undefined>();
		if (!sessionId) return new Map<string, FileReviewStatus | undefined>();
		if (!sessionReviewStateStore.isLoaded(sessionId))
			return new Map<string, FileReviewStatus | undefined>();

		return getReviewStatusByFilePath(
			modifiedFilesState.files,
			sessionReviewStateStore.getState(sessionId)
		);
	}
);
const reviewedFileCount = $derived.by(() => {
	if (!modifiedFilesState) return 0;
	return modifiedFilesState.files.reduce((count, file) => {
		const status = reviewStatusByFilePath.get(file.filePath);
		return status ? count + 1 : count;
	}, 0);
});

$effect(() => {
	if (!sessionId) return;
	sessionReviewStateStore.ensureLoaded(sessionId);
});

function toggleExpanded(): void {
	isExpanded = !isExpanded;
}

function handleReviewButtonClick(fileIndex: number): void {
	if (!modifiedFilesState) return;
	const preferFullscreen = reviewPreferenceStore.preferFullscreen;
	if (preferFullscreen && onOpenFullscreenReview) {
		onOpenFullscreenReview(modifiedFilesState, fileIndex);
	} else {
		onEnterReviewMode?.(modifiedFilesState, fileIndex);
	}
}

function handleCreatePrClick(): void {
	if (!onCreatePr) return;
	const config = buildPrGenerationRequestConfig(
		prPrefs.agentId,
		prPrefs.modelId,
		prPrefs.customPrompt,
		reactiveModels,
	);
	onCreatePr(config);
}

function handleAgentSelect(agentId: string, isSelected: boolean): void {
	const newAgentId = isSelected ? undefined : agentId;
	const nextEffectiveAgentId = newAgentId ? newAgentId : currentAgentId;
	const nextModels = nextEffectiveAgentId
		? agentModelPrefs.getCachedModels(nextEffectiveAgentId)
		: [];
	agentModelPrefs.setPrGenerationPrefs(
		buildPrGenerationPrefsForAgentSelection(
			newAgentId,
			prPrefs.modelId,
			prPrefs.customPrompt,
			nextModels,
		),
	);
}

function handleModelSelect(modelId: string, isSelected: boolean): void {
	agentModelPrefs.setPrGenerationPrefs({
		agentId: prPrefs.agentId,
		modelId: isSelected ? undefined : modelId,
		customPrompt: prPrefs.customPrompt,
	});
}

function handlePromptChange(e: Event): void {
	const textarea = e.target as HTMLTextAreaElement;
	const value = textarea.value.trim();
	agentModelPrefs.setPrGenerationPrefs({
		agentId: prPrefs.agentId,
		modelId: prPrefs.modelId,
		customPrompt: value.length > 0 ? value : undefined,
	});
}
</script>

{#if modifiedFilesState}
	<div class="w-full px-5 mb-2">
		<!-- Inline Expanded File List (in document flow) -->
		{#if isExpanded}
			<div class="rounded-t-md bg-muted/30 overflow-hidden border border-b-0 border-border">
				<!-- File list -->
				<div class="flex flex-col p-1 max-h-[300px] overflow-y-auto">
					{#each modifiedFilesState.files as file, index (file.filePath)}
						<InlineModifiedFileRow
							{file}
							fileIndex={index}
							reviewStatus={reviewStatusByFilePath.get(file.filePath)}
							onOpenReviewPanel={handleReviewButtonClick}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Header Bar (whole component clickable to expand/collapse) -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="button"
			tabindex="0"
			onclick={toggleExpanded}
			onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(); } }}
			class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors cursor-pointer {isExpanded
				? 'rounded-t-none border-t-0'
				: ''}"
		>
			<div class="flex items-center gap-1.5 text-[0.6875rem] min-w-0">
				<span class="text-foreground">
					{m.modified_files_count({ count: modifiedFilesState.fileCount })}
				</span>
				<!-- Diff stats summary -->
				<DiffPill insertions={totalAdded} deletions={totalRemoved} variant="plain" />
			</div>

			<div class="flex items-center gap-3 shrink-0">
				<!-- PR split button: main action + dropdown for agent/model/prompt config -->
				{#if onCreatePr}
					<DropdownMenu.Root>
						<div
							class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"
							onclick={(e: MouseEvent) => e.stopPropagation()}
							role="none"
						>
							<button
								type="button"
								disabled={createPrLoading}
								onclick={handleCreatePrClick}
								class="flex items-center gap-1 px-2 py-0.5 font-medium text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{#if createPrLoading}
									<Spinner class="size-3 shrink-0" />
									{createPrLabel ? createPrLabel : m.agent_panel_open_pr()}
								{:else}
									<GitPullRequest size={11} weight="bold" class="shrink-0" style="color: var(--success)" />
									{m.agent_panel_open_pr()}
								{/if}
							</button>
							<DropdownMenu.Trigger
								disabled={createPrLoading}
								class="self-stretch flex items-center px-1 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed"
								onclick={(e: MouseEvent) => e.stopPropagation()}
							>
								<DotsThreeVertical size={12} weight="bold" class="shrink-0" />
							</DropdownMenu.Trigger>
						</div>
						<DropdownMenu.Content align="end" class="w-[260px] p-0" sideOffset={4}>
							<!-- Agent Selection -->
							{#if availableAgents.length > 0}
								<div class="px-2.5 pt-2.5 pb-1">
									<div class="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
										<Robot size={10} weight="bold" class="shrink-0" />
										Agent
									</div>
								</div>
								<div class="px-1 pb-1">
									{#each availableAgents as agent (agent.id)}
										{@const icon = getAgentIcon(agent.id, effectiveTheme)}
										{@const isSelected = agent.id === effectiveAgentId}
										<DropdownMenu.Item
											onSelect={(e) => {
												e.preventDefault();
												handleAgentSelect(agent.id, isSelected);
											}}
											class="cursor-pointer text-[0.6875rem] py-1.5"
										>
											<div class="flex items-center gap-2 w-full">
												{#if icon}
													<img src={icon} alt={agent.name} class="h-3.5 w-3.5 shrink-0" />
												{/if}
												<span class="flex-1 truncate">{capitalizeName(agent.name)}</span>
												{#if isSelected}
													<Check size={12} weight="bold" class="shrink-0 text-primary" />
												{/if}
											</div>
										</DropdownMenu.Item>
									{/each}
								</div>
							{/if}

							<!-- Separator -->
							{#if availableAgents.length > 0 && reactiveModels.length > 0}
								<DropdownMenu.Separator />
							{/if}

							<!-- Model Selection (reacts to agent changes) -->
							{#if reactiveModels.length > 0}
								<div class="px-2.5 pt-1.5 pb-1">
									<div class="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
										<Cpu size={10} weight="bold" class="shrink-0" />
										Model
									</div>
								</div>
								<div class="px-1 pb-1.5 max-h-[180px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
									{#each reactiveModels as model (model.id)}
										{@const isSelected = model.id === effectiveModelId}
										{@const displayName = getModelDisplayName(model, effectiveAgentId)}
										<DropdownMenu.Item
											onSelect={(e) => {
												e.preventDefault();
												handleModelSelect(model.id, isSelected);
											}}
											class="cursor-pointer text-[0.6875rem] py-1.5"
										>
											<div class="flex items-center gap-2 w-full">
												<span class="flex-1 truncate">{displayName}</span>
												{#if isSelected}
													<Check size={12} weight="bold" class="shrink-0 text-primary" />
												{/if}
											</div>
										</DropdownMenu.Item>
									{/each}
								</div>
							{/if}

							<!-- Separator before prompt -->
							<DropdownMenu.Separator />

							<!-- Custom prompt section -->
							<div class="px-2.5 pt-1.5 pb-1">
								<button
									type="button"
									class="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors w-full"
									onclick={(e: MouseEvent) => {
										e.preventDefault();
										e.stopPropagation();
										showPromptEditor = !showPromptEditor;
									}}
								>
									<NotePencil size={10} weight="bold" class="shrink-0" />
									Prompt
									<AnimatedChevron isOpen={showPromptEditor} class="size-2.5 ml-auto" durationClass="duration-150" />
								</button>
							</div>
							{#if showPromptEditor}
								<div
									class="px-2.5 pb-2"
									onclick={(e: MouseEvent) => e.stopPropagation()}
									onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
									role="none"
								>
									<textarea
										class="w-full min-h-[80px] max-h-[160px] text-[0.6875rem] leading-snug rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-foreground placeholder:text-muted-foreground/50 resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
										placeholder="Custom instructions for PR generation…"
										value={prPrefs.customPrompt ? prPrefs.customPrompt : ""}
										onchange={handlePromptChange}
									></textarea>
									<p class="text-[0.5625rem] text-muted-foreground/60 mt-1 leading-tight">
										Replaces the default prompt. Leave empty to use built-in template with ASCII flow diagrams.
									</p>
								</div>
							{/if}

							<!-- Footer: current selection summary + create action -->
							<div class="border-t border-border/50 px-2.5 py-2">
								<div class="flex items-center gap-2 text-[0.625rem] text-muted-foreground mb-2">
									{#if effectiveAgent}
										{@const agentIcon = getAgentIcon(effectiveAgent.id, effectiveTheme)}
										{#if agentIcon}
											<img src={agentIcon} alt={effectiveAgent.name} class="h-3 w-3 shrink-0" />
										{/if}
										<span class="truncate">{capitalizeName(effectiveAgent.name)}</span>
										<span class="text-border">·</span>
									{/if}
									<Cpu size={10} weight="fill" class="shrink-0" />
									<span class="truncate">{effectiveModelDisplayName}</span>
								</div>
								<button
									type="button"
									disabled={createPrLoading}
									onclick={handleCreatePrClick}
									class="w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[0.6875rem] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{#if createPrLoading}
										<Spinner class="size-3 shrink-0" />
										{createPrLabel ? createPrLabel : m.agent_panel_open_pr()}
									{:else}
										<GitPullRequest size={11} weight="bold" class="shrink-0" />
										Create PR
									{/if}
								</button>
							</div>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{/if}

				<!-- Review split button -->
				<DropdownMenu.Root>
					<div
						class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"
						onclick={(e: MouseEvent) => e.stopPropagation()}
						role="none"
					>
						<button
							type="button"
							class="flex items-center gap-1 px-2 py-0.5 font-medium text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors"
							onclick={() => handleReviewButtonClick(0)}
						>
							<FileCode size={11} weight="fill" class="shrink-0" />
							{m.modified_files_review_button()}
						</button>
						<DropdownMenu.Trigger
							class="self-stretch flex items-center px-1 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors outline-none"
							onclick={(e: MouseEvent) => e.stopPropagation()}
						>
							<svg class="size-2.5" viewBox="0 0 10 10" fill="none">
								<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</DropdownMenu.Trigger>
					</div>
					<DropdownMenu.Content align="end" class="min-w-[140px]">
						<DropdownMenu.Item
							onSelect={() => {
								void reviewPreferenceStore.setPreferFullscreen(false);
								if (modifiedFilesState) onEnterReviewMode?.(modifiedFilesState, 0);
							}}
							class="cursor-pointer text-[0.6875rem]"
						>
							<SidebarSimple size={12} weight="fill" class="shrink-0" />
							{m.modified_files_review_panel()}
						</DropdownMenu.Item>
						<DropdownMenu.Item
							onSelect={() => {
								void reviewPreferenceStore.setPreferFullscreen(true);
								if (modifiedFilesState) onOpenFullscreenReview?.(modifiedFilesState, 0);
							}}
							class="cursor-pointer text-[0.6875rem]"
						>
							<ArrowsOut size={12} weight="bold" class="shrink-0" />
							{m.modified_files_review_fullscreen()}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<!-- Reviewed count -->
				<span class="text-muted-foreground tabular-nums text-[0.6875rem]">
					{reviewedFileCount}/{modifiedFilesState.fileCount}
				</span>

				<!-- Expand/collapse chevron -->
				<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground" />
			</div>
		</div>
	</div>
{/if}
