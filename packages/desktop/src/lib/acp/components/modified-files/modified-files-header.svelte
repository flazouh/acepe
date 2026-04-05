<script lang="ts">
import { DiffPill } from "@acepe/ui";
import { Button } from "@acepe/ui/button";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import ArrowsOut from "phosphor-svelte/lib/ArrowsOut";
import Check from "phosphor-svelte/lib/Check";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import DotsThreeVertical from "phosphor-svelte/lib/DotsThreeVertical";
import FileCode from "phosphor-svelte/lib/FileCode";
import GitMerge from "phosphor-svelte/lib/GitMerge";
import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
import NotePencil from "phosphor-svelte/lib/NotePencil";
import Robot from "phosphor-svelte/lib/Robot";
import SidebarSimple from "phosphor-svelte/lib/SidebarSimple";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/paraglide/messages.js";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import { mergeStrategyStore } from "../../store/merge-strategy-store.svelte.js";
import PrStateIcon from "../pr-state-icon.svelte";
import type { Model } from "../../application/dto/model.js";
import { getAgentIcon } from "../../constants/thread-list-constants.js";
import type { AgentInfo } from "../../logic/agent-manager.js";
import * as agentModelPrefs from "../../store/agent-model-preferences-store.svelte.js";
import { getReviewPreferenceStore } from "../../store/review-preference-store.svelte.js";
import { sessionReviewStateStore } from "../../store/session-review-state-store.svelte.js";
import { capitalizeName } from "../../utils/string-formatting.js";
import { getModelDisplayName } from "../model-selector-logic.js";
import AnimatedChevron from "../animated-chevron.svelte";
import SelectorCheck from "../selector-check.svelte";
import type { FileReviewStatus } from "../review-panel/review-session-state.js";
import InlineModifiedFileRow from "./components/inline-modified-file-row.svelte";
import { buildKeepAllReviewEntries } from "./logic/keep-all-review-progress.js";
import {
	DEFAULT_SHIP_INSTRUCTIONS,
	normalizeCustomShipInstructions,
} from "./logic/build-pr-prompt-preview.js";
import {
	buildPrGenerationPrefsForAgentSelection,
	buildPrGenerationRequestConfig,
	getValidPrGenerationModelId,
} from "./logic/pr-generation-preferences.js";
import { getReviewStatusByFilePath, hasKeepAllBeenApplied } from "./logic/review-progress.js";
import type { ModifiedFilesState } from "./types/modified-files-state.js";

/**
 * Configuration for the agent and model to use when generating PR content.
 */
export interface PrGenerationConfig {
	agentId?: string;
	modelId?: string;
	/** User-provided instructions layered ahead of the hidden response contract and diff context. */
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
	/** Optional: when provided, shows Merge button (after PR is created) */
	onMerge?: (strategy: MergeStrategy) => void;
	/** Disables the Merge button when true (e.g. while merge in flight) */
	merging?: boolean;
	/** PR state used to decide between merge button and merged badge */
	prState?: "OPEN" | "CLOSED" | "MERGED" | null;
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
	onMerge,
	merging = false,
	prState = null,
	availableAgents = [],
	currentAgentId = null,
	currentModelId = null,
	effectiveTheme = "dark",
}: Props = $props();

// Get review preference store at component initialization (not in handlers)
const reviewPreferenceStore = getReviewPreferenceStore();

let isExpanded = $state(false);
let hasPromptDraft = $state(false);
let promptDraft = $state("");

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
	if (!effectiveModel) return "Choose model";
	return getModelDisplayName(effectiveModel, effectiveAgentId);
});

const effectiveAgentDisplayName = $derived.by(() => {
	if (!effectiveAgent) return "Choose agent";
	return capitalizeName(effectiveAgent.name);
});

const effectiveAgentIcon = $derived.by(() => {
	if (!effectiveAgent) return null;
	return getAgentIcon(effectiveAgent.id, effectiveTheme);
});

const promptEditorBaseline = $derived.by(() => {
	const normalizedSavedPrompt = normalizeCustomShipInstructions(prPrefs.customPrompt);
	if (normalizedSavedPrompt) {
		return normalizedSavedPrompt;
	}

	return DEFAULT_SHIP_INSTRUCTIONS;
});

const resolvedPromptEditorValue = $derived.by(() => {
	if (hasPromptDraft) {
		return promptDraft;
	}

	return promptEditorBaseline;
});

const promptPreviewHelperText = $derived.by(() => {
	return "Acepe adds the XML response format, current branch, changed files, and diff automatically.";
});

const hasUnsavedPromptChanges = $derived(hasPromptDraft && promptDraft !== promptEditorBaseline);

const canSavePrompt = $derived(
	hasUnsavedPromptChanges && resolvedPromptEditorValue.trim().length > 0
);

const canResetPrompt = $derived(
	hasPromptDraft || Boolean(normalizeCustomShipInstructions(prPrefs.customPrompt))
);

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

const isKeepAllApplied = $derived.by(() => {
	if (!modifiedFilesState) {
		return false;
	}

	if (!sessionId) {
		return false;
	}

	if (!sessionReviewStateStore.isLoaded(sessionId)) {
		return false;
	}

	return hasKeepAllBeenApplied(
		modifiedFilesState.files,
		sessionReviewStateStore.getState(sessionId)
	);
});

const canKeepAll = $derived.by(() => {
	if (!sessionId) {
		return false;
	}

	if (!sessionReviewStateStore.isLoaded(sessionId)) {
		return false;
	}

	return !isKeepAllApplied;
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
		resolveCustomPrompt(),
		reactiveModels,
	);
	onCreatePr(config);
}

function handleKeepAllClick(): void {
	if (!sessionId) {
		return;
	}

	if (!modifiedFilesState) {
		return;
	}

	if (!sessionReviewStateStore.isLoaded(sessionId)) {
		return;
	}

	const reviewEntries = buildKeepAllReviewEntries(modifiedFilesState.files);

	for (const reviewEntry of reviewEntries) {
		sessionReviewStateStore.upsertFileProgress(
			sessionId,
			reviewEntry.revisionKey,
			reviewEntry.progress
		);
	}
}

function handleAgentPickerChange(value: string): void {
	if (value === effectiveAgentId) {
		return;
	}

	const nextEffectiveAgentId = value;
	const nextModels = nextEffectiveAgentId
		? agentModelPrefs.getCachedModels(nextEffectiveAgentId)
		: [];
	agentModelPrefs.setPrGenerationPrefs(
		buildPrGenerationPrefsForAgentSelection(
			value,
			prPrefs.modelId,
			normalizeCustomShipInstructions(prPrefs.customPrompt),
			nextModels,
		),
	);
}

function handleModelPickerChange(value: string): void {
	if (value === effectiveModelId) {
		return;
	}

	agentModelPrefs.setPrGenerationPrefs({
		agentId: prPrefs.agentId,
		modelId: value,
		customPrompt: normalizeCustomShipInstructions(prPrefs.customPrompt),
	});
}

function handlePromptChange(e: Event): void {
	hasPromptDraft = true;
	promptDraft = (e.target as HTMLTextAreaElement).value;
}

function resolveCustomPrompt(): string | undefined {
	if (hasPromptDraft) {
		return normalizeCustomShipInstructions(promptDraft);
	}

	return normalizeCustomShipInstructions(prPrefs.customPrompt);
}

function handlePromptSaveClick(): void {
	const nextPrompt = resolvedPromptEditorValue.trim();
	if (nextPrompt.length === 0) {
		return;
	}
	const normalizedNextPrompt = normalizeCustomShipInstructions(nextPrompt);

	hasPromptDraft = false;
	promptDraft = "";
	agentModelPrefs.setPrGenerationPrefs({
		agentId: prPrefs.agentId,
		modelId: prPrefs.modelId,
		customPrompt: normalizedNextPrompt,
	});
}

function handlePromptResetClick(): void {
	hasPromptDraft = false;
	promptDraft = "";
	agentModelPrefs.setPrGenerationPrefs({
		agentId: prPrefs.agentId,
		modelId: prPrefs.modelId,
		customPrompt: undefined,
	});
}
</script>

{#if modifiedFilesState}
	<div class="w-full px-5">
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
			class="w-full flex items-center justify-between pl-1 pr-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors cursor-pointer {isExpanded
				? 'rounded-t-none border-t-0'
				: ''}"
		>
			<div class="flex items-center gap-2 shrink-0 min-w-0">
				<!-- PR split button: main action + dropdown for agent/model/prompt config -->
				{#if onCreatePr}
					<DropdownMenu.Root>
						<div
							class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"
							onclick={(e: MouseEvent) => e.stopPropagation()}
							role="none"
						>
							<Button
								variant="headerAction"
								size="headerAction"
								class="group/open-pr rounded-none border-0 bg-transparent shadow-none"
								disabled={createPrLoading}
								onclick={handleCreatePrClick}
							>
								<span class="flex items-center gap-1 shrink-0">
									{#if createPrLoading}
										<Spinner class="size-3 shrink-0" />
										{createPrLabel ? createPrLabel : m.agent_panel_open_pr()}
									{:else}
										<GitPullRequest
											size={11}
											weight="bold"
											class="shrink-0 text-muted-foreground transition-colors group-hover/open-pr:text-success"
										/>
										{m.agent_panel_open_pr()}
									{/if}
								</span>
								<DiffPill insertions={totalAdded} deletions={totalRemoved} variant="plain" />
							</Button>
							<DropdownMenu.Trigger
								disabled={createPrLoading}
								class="self-stretch flex items-center px-1 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed"
								onclick={(e: MouseEvent) => e.stopPropagation()}
							>
								<DotsThreeVertical size={12} weight="bold" class="shrink-0" />
							</DropdownMenu.Trigger>
						</div>
						<DropdownMenu.Content align="start" class="w-[420px] overflow-hidden p-0" sideOffset={6}>
							<div class="border-b border-border/50 bg-muted/20 px-3 py-2.5">
								<div class="flex items-center gap-2 text-[0.6875rem] font-medium text-foreground/90">
									<GitPullRequest size={12} weight="bold" class="shrink-0 text-muted-foreground" />
									PR settings
								</div>
								<p class="mt-1 text-[0.625rem] leading-relaxed text-muted-foreground/70">
									Choose the agent, choose the model, and save review instructions. Acepe appends the response format and git context automatically.
								</p>
							</div>

							<div class="border-b border-border/50 px-3 py-2.5">
								<div class="grid gap-1.5 sm:grid-cols-2">
									<div class="space-y-1.5">
										<div class="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
											<Robot size={10} weight="bold" class="shrink-0" />
											Agent
										</div>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger
												disabled={availableAgents.length === 0}
												class="flex w-full items-center gap-1.5 rounded-md border border-border/50 bg-background/70 px-2 py-1 text-[11px] text-foreground/85 transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
												onclick={(e: MouseEvent) => e.stopPropagation()}
											>
												{#if effectiveAgentIcon}
													<img src={effectiveAgentIcon} alt={effectiveAgentDisplayName} class="h-3 w-3 shrink-0" />
												{/if}
												<span class="flex-1 truncate text-left">{effectiveAgentDisplayName}</span>
												<svg class="size-2.5 shrink-0 text-muted-foreground" viewBox="0 0 10 10" fill="none">
													<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
												</svg>
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="start" class="w-[190px] p-0" sideOffset={6}>
												{#each availableAgents as agent (agent.id)}
													{@const icon = getAgentIcon(agent.id, effectiveTheme)}
													{@const isSelected = agent.id === effectiveAgentId}
													<DropdownMenu.Item
														onSelect={() => handleAgentPickerChange(agent.id)}
														class="group/item py-0.5 {isSelected ? 'bg-accent' : ''}"
													>
														<div class="flex w-full min-w-0 items-center gap-1.5">
															{#if icon}
																<img src={icon} alt={agent.name} class="h-3.5 w-3.5 shrink-0" />
															{/if}
															<span class="flex-1 truncate text-[11px]">{capitalizeName(agent.name)}</span>
															<SelectorCheck visible={isSelected} />
														</div>
													</DropdownMenu.Item>
												{/each}
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									</div>

									<div class="space-y-1.5">
										<div class="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
											Model
										</div>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger
												disabled={reactiveModels.length === 0}
												class="flex w-full items-center gap-1.5 rounded-md border border-border/50 bg-background/70 px-2 py-1 text-[11px] text-foreground/85 transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
												onclick={(e: MouseEvent) => e.stopPropagation()}
											>
												<span class="flex-1 truncate text-left">{effectiveModelDisplayName}</span>
												<svg class="size-2.5 shrink-0 text-muted-foreground" viewBox="0 0 10 10" fill="none">
													<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
												</svg>
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="start" class="w-[210px] p-0" sideOffset={6}>
												{#each reactiveModels as model (model.id)}
													{@const displayName = getModelDisplayName(model, effectiveAgentId)}
													{@const isSelected = model.id === effectiveModelId}
													<DropdownMenu.Item
														onSelect={() => handleModelPickerChange(model.id)}
														class="group/item py-0.5 {isSelected ? 'bg-accent' : ''}"
													>
														<div class="flex w-full min-w-0 items-center gap-1.5">
															<span class="flex-1 truncate text-[11px]">{displayName}</span>
															<SelectorCheck visible={isSelected} />
														</div>
													</DropdownMenu.Item>
												{/each}
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									</div>
								</div>
							</div>

							<div class="px-3 py-2.5">
								<div class="flex items-center justify-between gap-3">
									<div>
										<div class="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
											<NotePencil size={10} weight="bold" class="shrink-0" />
											PR instructions
										</div>
										<p class="mt-1 text-[0.625rem] leading-relaxed text-muted-foreground/65">
											{promptPreviewHelperText}
										</p>
									</div>
									<div class="flex shrink-0 items-center gap-1.5">
										<button
											type="button"
											disabled={!canResetPrompt}
											onclick={(e: MouseEvent) => {
												e.preventDefault();
												e.stopPropagation();
												handlePromptResetClick();
											}}
											class="rounded border border-border/50 px-2 py-1 text-[0.625rem] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
										>
											Reset
										</button>
										<button
											type="button"
											disabled={!canSavePrompt}
											onclick={(e: MouseEvent) => {
												e.preventDefault();
												e.stopPropagation();
												handlePromptSaveClick();
											}}
											class="rounded border border-[#D6A16A] bg-[#F4D2AE] px-2 py-1 text-[0.625rem] font-medium text-[#5B3818] transition-colors hover:bg-[#EEC18F] disabled:cursor-not-allowed disabled:opacity-50"
										>
											Save prompt
										</button>
									</div>
								</div>
								<textarea
									class="mt-2 w-full min-h-[150px] max-h-[260px] resize-y rounded-md border border-border/50 bg-background/70 px-2.5 py-2 text-[0.6875rem] leading-snug text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:ring-1 focus:ring-primary/35"
									placeholder="Add PR instructions for Acepe to apply"
									spellcheck="false"
									value={resolvedPromptEditorValue}
									oninput={handlePromptChange}
									onclick={(e: MouseEvent) => e.stopPropagation()}
									onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
								></textarea>
							</div>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{/if}

				<!-- Merge split button: shown after PR is created -->
				{#if !onCreatePr && onMerge}
					{#if prState === "MERGED"}
						<div
							class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground opacity-60 shrink-0"
							onclick={(e: MouseEvent) => e.stopPropagation()}
							role="none"
						>
							<PrStateIcon state="MERGED" size={11} />
							{m.pr_card_merged()}
						</div>
					{:else}
						<DropdownMenu.Root>
							<div
								class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"
								onclick={(e: MouseEvent) => e.stopPropagation()}
								role="none"
							>
								<button
									type="button"
									disabled={merging}
									onclick={() => onMerge(mergeStrategyStore.strategy)}
									class="px-2 py-0.5 text-[0.6875rem] font-medium text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{#if merging}
										<span class="flex items-center gap-1">
											<Spinner class="size-[11px]" />
											{m.pr_card_merge()}
										</span>
									{:else}
										<span class="flex items-center gap-1">
											<GitMerge size={11} weight="fill" />
											{m.pr_card_merge()}
										</span>
									{/if}
								</button>
								<DropdownMenu.Trigger
									class="self-stretch flex items-center px-1 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 outline-none"
									disabled={merging}
									onclick={(e: MouseEvent) => e.stopPropagation()}
								>
									<svg class="size-2.5 text-muted-foreground" viewBox="0 0 10 10" fill="none">
										<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
									</svg>
								</DropdownMenu.Trigger>
							</div>
							<DropdownMenu.Content align="start" class="min-w-[150px]">
								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("squash"); onMerge("squash"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{m.pr_card_squash_merge()}
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("merge"); onMerge("merge"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{m.pr_card_merge_commit()}
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("rebase"); onMerge("rebase"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{m.pr_card_rebase_merge()}
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				{/if}

				<!-- DiffPill when no create-PR button (PR already exists) -->
				{#if !onCreatePr && modifiedFilesState}
					<DiffPill insertions={totalAdded} deletions={totalRemoved} variant="plain" />
				{/if}
			</div>

			<div class="flex items-center gap-3 shrink-0 ml-auto">
				<!-- Review split button -->
				<DropdownMenu.Root>
					<div
						class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"
						onclick={(e: MouseEvent) => e.stopPropagation()}
						role="none"
					>
						<Button
							variant="headerAction"
							size="headerAction"
							class="rounded-none border-0 bg-transparent shadow-none"
							onclick={() => handleReviewButtonClick(0)}
						>
							<FileCode size={11} weight="fill" class="shrink-0" />
							{m.modified_files_review_button()}
						</Button>
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

				<div role="none" onclick={(e: MouseEvent) => e.stopPropagation()}>
					{#if isKeepAllApplied}
						<Button variant="headerAction" size="headerAction" disabled class="disabled:opacity-100">
							<CheckCircle size={11} weight="fill" class="shrink-0 text-success" />
							{m.review_applied()}
						</Button>
					{:else}
						<button
							type="button"
							disabled={!canKeepAll}
							onclick={handleKeepAllClick}
							class="flex items-center gap-1 rounded border border-[#E5A96D] bg-[#FFC799] px-2 py-0.5 text-[0.6875rem] font-medium text-[#5B3818] transition-colors hover:bg-[#FFB86B] disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Check size={11} weight="bold" class="shrink-0" />
							{m.review_keep()}
						</button>
					{/if}
				</div>

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
