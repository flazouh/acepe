<script lang="ts">
import {
	AgentPanelModifiedFileRow as SharedAgentPanelModifiedFileRow,
	AgentPanelModifiedFilesHeader as SharedAgentPanelModifiedFilesHeader,
	AgentPanelModifiedFilesTrailingControls as SharedAgentPanelModifiedFilesTrailingControls,
	DiffPill,
	RoundedIcon,
	Selector,
	type AgentPanelModifiedFilesTrailingModel,
} from "@acepe/ui";
import { Button } from "@acepe/ui/button";
import * as ButtonGroup from "@acepe/ui/button-group";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { Textarea } from "$lib/components/ui/textarea/index.js";
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
import { sessionReviewStateStore } from "../../store/session-review-state-store.svelte.js";
import { capitalizeName } from "../../utils/string-formatting.js";
import { getModelDisplayName } from "../model-selector-logic.js";
import { SelectorItem } from "@acepe/ui";
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
	/** Disambiguating badge label for the project */
	projectBadgeLabel?: string | null;
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
	projectBadgeLabel = null,
	availableAgents = [],
	currentAgentId = null,
	currentModelId = null,
	effectiveTheme = "dark",
}: Props = $props();

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

const mergeStrategyOptions: readonly { readonly value: MergeStrategy; readonly label: string }[] = [
	{ value: "squash", label: "Squash merge" },
	{ value: "merge", label: "Merge commit" },
	{ value: "rebase", label: "Rebase merge" },
];

function handleMergeStrategyChange(value: string): void {
	if (value !== "squash" && value !== "merge" && value !== "rebase") {
		return;
	}
	void mergeStrategyStore.set(value);
	onMerge?.(value);
}

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
	onOpenFullscreenReview?.(modifiedFilesState, fileIndex);
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
				<!-- PR action group: open PR + options menu -->
				{#if onCreatePr}
					<div
						class="flex shrink-0 items-center gap-1"
						onclick={(e: MouseEvent) => e.stopPropagation()}
						role="none"
					>
						<ButtonGroup.Root
							class="shrink-0 text-[0.6875rem]"
							aria-label="Open pull request"
						>
							<Button
								variant="secondary"
								size="xs"
								class="group/open-pr"
								disabled={createPrLoading}
								onclick={handleCreatePrClick}
							>
								<span class="flex shrink-0 items-center gap-1">
									{#if createPrLoading}
										<Spinner class="shrink-0" size={12} />
										{createPrLabel ? createPrLabel : "Open PR"}
									{:else}
										<RoundedIcon
											name="pull-request"
											class="size-[11px] shrink-0 text-muted-foreground transition-colors group-hover/open-pr:text-success"
										/>
										{"Open PR"}
									{/if}
								</span>
								<DiffPill insertions={diffTotals.totalAdded} deletions={diffTotals.totalRemoved} variant="plain" />
							</Button>

							<Selector
								embeddedInGroup
								showChevron={false}
								triggerSize="headerAction"
								variant="secondary"
								align="start"
								sideOffset={6}
								contentClass="min-w-[200px]"
								triggerAriaLabel="PR options"
								triggerClass="!px-1"
								disabled={createPrLoading}
							>
								{#snippet renderButton()}
									<RoundedIcon name="more" class="size-[11px] shrink-0" />
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
												<SelectorItem
													label={capitalizeName(agent.name)}
													selected={agent.id === effectiveAgentId}
													onSelect={() => handleAgentPickerChange(agent.id)}
												>
													{#snippet leading()}
														<AgentIcon
															agentId={agent.id}
															providerBrand={agent.provider_metadata?.providerBrand ?? null}
															providerLabel={agent.provider_metadata?.displayName ?? agent.name}
															class="h-3.5 w-3.5 shrink-0"
															size={14}
														/>
													{/snippet}
												</SelectorItem>
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
												<SelectorItem
													label={displayName}
													selected={model.id === effectiveModelId}
													onSelect={() => handleModelPickerChange(model.id)}
												/>
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

									{#if sessionId && projectPath}
										<DropdownMenu.Separator />
										<PrLinkFooterButton
											{sessionId}
											{projectPath}
											{linkedPr}
											prLinkMode={prLinkMode ?? "automatic"}
											{projectPrLinkReferences}
											{project}
											{projectBadgeLabel}
											variant="menu"
										/>
									{/if}
							</Selector>
						</ButtonGroup.Root>

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
						<div onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
							<Button variant="secondary" size="xs" disabled>
								<PrStateIcon state="MERGED" size={11} />
								{"Merged"}
							</Button>
						</div>
					{:else}
						<ButtonGroup.Root class="shrink-0 text-[0.6875rem]" aria-label="Merge pull request">
							<Button
								variant="secondary"
								size="xs"
								disabled={merging}
								onclick={() => onMerge(mergeStrategyStore.strategy)}
							>
								{#if merging}
									<Spinner size={11} />
									{"Merge"}
								{:else}
									<RoundedIcon name="pull-request-merged" class="size-[11px]" />
									{"Merge"}
								{/if}
							</Button>
							<Selector
								embeddedInGroup
								showChevron={false}
								triggerSize="headerAction"
								variant="secondary"
								align="start"
								contentClass="min-w-[160px]"
								triggerAriaLabel="Merge options"
								disabled={merging}
							>
								{#snippet renderButton()}
									<RoundedIcon name="chevron-down" class="size-3 shrink-0" />
								{/snippet}

								<DropdownMenu.RadioGroup
										value={mergeStrategyStore.strategy}
										onValueChange={handleMergeStrategyChange}
									>
										{#each mergeStrategyOptions as option (option.value)}
											<DropdownMenu.RadioItem value={option.value} class="cursor-pointer text-[0.6875rem]">
												{option.label}
											</DropdownMenu.RadioItem>
										{/each}
									</DropdownMenu.RadioGroup>
							</Selector>
						</ButtonGroup.Root>
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

	<DialogFrame
		bind:open={promptDialogOpen}
		title="PR prompt"
		closeLabel="Close PR prompt editor"
		size="medium"
		contentClass="max-w-lg"
	>
		<div class="grid gap-2 px-3 py-3">
			<p class="text-[12px] text-muted-foreground">
				Customize the instructions Acepe uses before it adds branch, changed-file, diff, and XML
				response context.
			</p>
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

		{#snippet footer()}
			<Button
				variant="outline"
				size="sm"
				disabled={!promptEditorState.canReset}
				onclick={handlePromptResetClick}
			>
				Reset
			</Button>
			<Button
				variant="default"
				size="sm"
				disabled={!promptEditorState.canSave}
				onclick={handlePromptSaveClick}
			>
				Save prompt
			</Button>
		{/snippet}
	</DialogFrame>
{/if}
