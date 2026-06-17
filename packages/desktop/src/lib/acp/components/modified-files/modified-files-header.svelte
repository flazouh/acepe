<script lang="ts">
import {
	AgentPanelModifiedFileRow as SharedAgentPanelModifiedFileRow,
	AgentPanelModifiedFilesHeader as SharedAgentPanelModifiedFilesHeader,
	AgentPanelModifiedFilesTrailingControls as SharedAgentPanelModifiedFilesTrailingControls,
	DiffPill,
	Selector,
	type AgentPanelModifiedFilesTrailingModel,
} from "@acepe/ui";
import { Button } from "@acepe/ui/button";
import * as Dialog from "@acepe/ui/dialog";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Textarea } from "$lib/components/ui/textarea/index.js";
import { GitMerge, GitPullRequest, LinkSimple, SlidersHorizontal } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import type {
	SessionLinkedPr,
	SessionPrLinkMode,
	SessionPrLinkReference,
} from "$lib/acp/application/dto/session-linked-pr.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import { mergeStrategyStore } from "../../store/merge-strategy-store.svelte.js";
import PrStateIcon from "../pr-state-icon.svelte";
import type { Model } from "../../application/dto/model.js";
import type { AgentInfo } from "../../logic/agent-manager.js";
import * as agentModelPrefs from "../../store/agent-model-preferences-store.svelte.js";
import { getReviewPreferenceStore } from "../../store/review-preference-store.svelte.js";
import { sessionReviewStateStore } from "../../store/session-review-state-store.svelte.js";
import { capitalizeName } from "../../utils/string-formatting.js";
import { getModelDisplayName } from "../model-selector-logic.js";
import SelectorCheck from "../selector-check.svelte";
import AgentIcon from "../agent-icon.svelte";
import type { FileReviewStatus } from "../review-panel/review-session-state.js";
import { normalizeCustomShipInstructions } from "./logic/build-pr-prompt-preview.js";
import {
	buildPrGenerationPrefsForAgentSelection,
	buildPrGenerationRequestConfig,
	getValidPrGenerationModelId,
} from "./logic/pr-generation-preferences.js";
import PrLinkFooterButton from "../shared/pr-link-footer-button.svelte";
import { getReviewStatusByFilePath } from "./logic/review-progress.js";
import type { ModifiedFilesState } from "../../types/modified-files-state.js";
import {
	countReviewedFiles,
	getModifiedFilesDiffTotals,
	getPromptEditorState,
	mapReviewStatusForHeader,
} from "./logic/modified-files-header-state.js";

import type { PrGenerationConfig } from "./types/pr-generation-config.js";

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
	/** Called when Review should open without changing the parent panel layout */
	onOpenReviewDialog?: (modifiedFilesState: ModifiedFilesState, fileIndex: number) => void;
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
	/** Project path for manually linking an existing PR from the header menu */
	projectPath?: string | null;
	/** Current session-linked PR, when one is known */
	linkedPr?: SessionLinkedPr | null;
	/** Whether the current session PR link is automatic or manually selected */
	prLinkMode?: SessionPrLinkMode | null;
	/** Minimal session references used to show and transfer existing PR links */
	projectPrLinkReferences?: readonly SessionPrLinkReference[];
	/** Project metadata used for linked-session badges */
	project?: Project | null;
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
	onOpenReviewDialog,
	onOpenFullscreenReview,
	onCreatePr,
	createPrLoading = false,
	createPrLabel = null,
	onMerge,
	merging = false,
	prState = null,
	projectPath = null,
	linkedPr = null,
	prLinkMode = "automatic",
	projectPrLinkReferences = [],
	project = null,
	availableAgents = [],
	currentAgentId = null,
	currentModelId = null,
	effectiveTheme = "dark",
}: Props = $props();

// Get review preference store at component initialization (not in handlers)
const reviewPreferenceStore = getReviewPreferenceStore();

let hasPromptDraft = $state(false);
let promptDraft = $state("");
let promptDialogOpen = $state(false);

// PR generation preferences — persisted globally via SQLite
const prPrefs = $derived(agentModelPrefs.getPrGenerationPrefs());

// Derived effective values (persisted override > current default)
const effectiveAgentId = $derived(prPrefs.agentId ? prPrefs.agentId : currentAgentId);

// Models react to the effective agent selection — when the user picks a
// different agent in the dropdown the model list updates automatically.
const reactiveModels = $derived(
	effectiveAgentId ? agentModelPrefs.getCachedModels(effectiveAgentId) : []
);
const reactiveModelsDisplay = $derived(
	effectiveAgentId ? agentModelPrefs.getCachedModelsDisplay(effectiveAgentId) : null
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
	return getModelDisplayName(effectiveModel, effectiveAgentId, reactiveModelsDisplay);
});

const effectiveAgentDisplayName = $derived.by(() => {
	if (!effectiveAgent) return "Choose agent";
	return capitalizeName(effectiveAgent.name);
});

const promptEditorState = $derived.by(() =>
	getPromptEditorState({
		savedPrompt: prPrefs.customPrompt,
		hasPromptDraft,
		promptDraft,
	})
);

const diffTotals = $derived.by(() => getModifiedFilesDiffTotals(modifiedFilesState));

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
	return countReviewedFiles(modifiedFilesState, reviewStatusByFilePath);
});

const trailingControlsModel = $derived<AgentPanelModifiedFilesTrailingModel>({
	reviewLabel: "Review",
	onReview: () => {
		handleReviewButtonClick(0);
	},
	reviewedCount: reviewedFileCount,
	totalCount: modifiedFilesState?.fileCount ?? 0,
});

$effect(() => {
	if (!sessionId) return;
	sessionReviewStateStore.ensureLoaded(sessionId);
});

function handleReviewButtonClick(fileIndex: number): void {
	if (!modifiedFilesState) return;
	if (onOpenReviewDialog) {
		onOpenReviewDialog(modifiedFilesState, fileIndex);
		return;
	}
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
		reactiveModels
	);
	onCreatePr(config);
}

function handleRevertFile(filePath: string): void {
	if (!projectPath) {
		toast.error("Cannot revert: no project path");
		return;
	}
	tauriClient.git.discardChanges(projectPath, [filePath]).match(
		() => toast.success(`Discarded changes in ${filePath.split("/").pop()}`),
		(err) => toast.error(`Failed to discard: ${err.message}`)
	);
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
			nextModels
		)
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
	const nextPrompt = promptEditorState.value.trim();
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
	promptDialogOpen = false;
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
	<SharedAgentPanelModifiedFilesHeader visible={true}>
		{#snippet fileList()}
			{#each modifiedFilesState.files as file, index (file.filePath)}
				<SharedAgentPanelModifiedFileRow
					file={{
						id: file.filePath,
						filePath: file.filePath,
						fileName: file.fileName,
						reviewStatus: mapReviewStatusForHeader(reviewStatusByFilePath.get(file.filePath)),
						additions: file.totalAdded,
						deletions: file.totalRemoved,
						onSelect: () => {
							handleReviewButtonClick(index);
						},
						onRevert: () => handleRevertFile(file.filePath),
					}}
				/>
			{/each}
		{/snippet}

		{#snippet leadingContent()}
				<!-- PR action group: open PR + generation settings + link existing -->
				{#if onCreatePr}
					<div
						class="flex shrink-0 items-center gap-1"
					>
						<div
							class="flex shrink-0 items-center rounded-lg border border-border/50 bg-muted text-[0.6875rem]"
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
								<span class="flex shrink-0 items-center gap-1">
									{#if createPrLoading}
										<Spinner class="shrink-0" size={12} />
										{createPrLabel ? createPrLabel : "Open PR"}
									{:else}
										<GitPullRequest size={11} weight="bold" class="shrink-0 text-muted-foreground transition-colors group-hover/open-pr:text-success" />
										{"Open PR"}
									{/if}
								</span>
								<DiffPill insertions={diffTotals.totalAdded} deletions={diffTotals.totalRemoved} variant="plain" />
							</Button>

							<!-- Generation settings: agent / model / prompt -->
							<Selector
								align="start"
								sideOffset={6}
								disabled={createPrLoading}
								variant="ghost"
								triggerSize="square"
								showChevron={false}
								tooltipLabel="PR generation settings"
								triggerAriaLabel="PR generation settings"
								class="self-stretch border-l border-border/50"
							>
								{#snippet renderButton()}
									<SlidersHorizontal size={11} weight="bold" class="shrink-0" />
								{/snippet}

								<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger disabled={availableAgents.length === 0} class="cursor-pointer">
											<span class="flex-1">Agent</span>
											<span class="max-w-[100px] truncate text-[10px] text-muted-foreground">
												{effectiveAgentDisplayName}
											</span>
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="w-[220px] max-h-[260px]">
											{#each availableAgents as agent (agent.id)}
												{@const isSelected = agent.id === effectiveAgentId}
												<DropdownMenu.Item
													onSelect={() => handleAgentPickerChange(agent.id)}
													class="group/item py-0.5 {isSelected ? 'bg-accent' : ''}"
												>
													<div class="flex w-full min-w-0 items-center gap-1.5">
														<AgentIcon
															agentId={agent.id}
															providerBrand={agent.provider_metadata?.providerBrand ?? null}
															providerLabel={agent.provider_metadata?.displayName ?? agent.name}
															class="h-3.5 w-3.5 shrink-0"
															size={14}
														/>
														<span class="flex-1 truncate text-[11px]">{capitalizeName(agent.name)}</span>
														<SelectorCheck visible={isSelected} />
													</div>
												</DropdownMenu.Item>
											{/each}
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>

									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger disabled={reactiveModels.length === 0} class="cursor-pointer">
											<span class="flex-1">Model</span>
											<span class="max-w-[132px] truncate text-[10px] text-muted-foreground">
												{effectiveModelDisplayName}
											</span>
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="w-[240px] max-h-[280px]">
											{#each reactiveModels as model (model.id)}
												{@const displayName = getModelDisplayName(model, effectiveAgentId, reactiveModelsDisplay)}
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
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>

									<DropdownMenu.Separator />

									<DropdownMenu.Item
										onSelect={() => {
											promptDialogOpen = true;
										}}
										class="cursor-pointer"
									>
										<span class="flex-1">Prompt</span>
										<span class="text-[10px] text-muted-foreground">{promptEditorState.statusLabel}</span>
									</DropdownMenu.Item>
							</Selector>

							<!-- Link existing PR: dedicated picker -->
							{#if sessionId && projectPath}
								<PrLinkFooterButton
									{sessionId}
									{projectPath}
									{linkedPr}
									prLinkMode={prLinkMode ?? "automatic"}
									{projectPrLinkReferences}
									{project}
									variant="header-icon"
								/>
							{/if}
						</div>

						<SharedAgentPanelModifiedFilesTrailingControls
							model={trailingControlsModel}
							isExpanded={false}
							showToggle={false}
							compactActions={true}
						/>
					</div>
				{:else}
					<SharedAgentPanelModifiedFilesTrailingControls
						model={trailingControlsModel}
						isExpanded={false}
						showToggle={false}
						compactActions={true}
					/>
				{/if}

				<!-- Merge split button: shown after PR is created -->
				{#if !onCreatePr && onMerge}
					{#if prState === "MERGED"}
						<div
							class="flex items-center gap-1 rounded-lg border border-border/50 bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground opacity-60 shrink-0"
							onclick={(e: MouseEvent) => e.stopPropagation()}
							role="none"
						>
							<PrStateIcon state="MERGED" size={11} />
							{"Merged"}
						</div>
					{:else}
						<div
							class="flex items-center rounded-lg border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"
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
										<Spinner size={11} />
										{"Merge"}
									</span>
								{:else}
									<span class="flex items-center gap-1">
										<GitMerge size={11} weight="fill" />
										{"Merge"}
									</span>
								{/if}
							</button>
							<Selector
								align="start"
								disabled={merging}
								variant="ghost"
								triggerSize="square"
								showChevron={false}
								triggerAriaLabel="Merge options"
								class="self-stretch border-l border-border/50"
							>
								{#snippet renderButton()}
									<svg class="size-2.5 text-muted-foreground" viewBox="0 0 10 10" fill="none">
										<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
									</svg>
								{/snippet}

								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("squash"); onMerge("squash"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{"Squash merge"}
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("merge"); onMerge("merge"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{"Merge commit"}
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onSelect={() => { void mergeStrategyStore.set("rebase"); onMerge("rebase"); }}
									class="cursor-pointer text-[0.6875rem]"
								>
									{"Rebase merge"}
								</DropdownMenu.Item>
							</Selector>
						</div>
					{/if}
				{/if}

				<!-- DiffPill when no create-PR button (PR already exists) -->
				{#if !onCreatePr && modifiedFilesState}
					<DiffPill insertions={diffTotals.totalAdded} deletions={diffTotals.totalRemoved} variant="plain" />
				{/if}
		{/snippet}

		{#snippet trailingContent(isExpanded: boolean, onToggle: () => void)}
			<SharedAgentPanelModifiedFilesTrailingControls
				model={trailingControlsModel}
				{isExpanded}
				{onToggle}
				showActions={false}
			/>
		{/snippet}
	</SharedAgentPanelModifiedFilesHeader>

	<Dialog.Root bind:open={promptDialogOpen}>
		<Dialog.Content class="max-w-lg">
			<Dialog.Header>
				<Dialog.Title>PR prompt</Dialog.Title>
				<Dialog.Description>
					Customize the instructions Acepe uses before it adds branch, changed-file, diff, and XML response context.
				</Dialog.Description>
			</Dialog.Header>

			<div class="grid gap-2 py-2">
				<Textarea
					class="min-h-[240px] max-h-[420px] resize-y text-xs leading-relaxed"
					placeholder="Add PR instructions for Acepe to apply"
					spellcheck="false"
					value={promptEditorState.value}
					oninput={handlePromptChange}
				/>
				<p class="text-xs text-muted-foreground">
					{promptEditorState.helperText}
				</p>
			</div>

			<Dialog.Footer>
				<Button
					variant="header"
					size="header"
					disabled={!promptEditorState.canReset}
					onclick={handlePromptResetClick}
				>
					Reset
				</Button>
				<Button
					variant="invert"
					size="header"
					disabled={!promptEditorState.canSave}
					onclick={handlePromptSaveClick}
				>
					Save prompt
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
