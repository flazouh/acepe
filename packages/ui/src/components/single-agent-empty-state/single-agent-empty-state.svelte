<!--
  SingleAgentEmptyState — Composite presentational shell for the
  single-agent empty-state layout.

  Composes:
    AgentSelectorView, ProjectSelectorView, BranchPickerView (Unit 3),
    AgentInputView (Unit 4), AgentPanelErrorCard, AgentPanelPreSessionWorktreeCard.

  Renders model-based defaults for each section but accepts snippet
  overrides so a desktop controller can inject platform-specific components
  (e.g. the full AgentInput with session/worktree/voice logic).

  Created for Unit 5 of the landing-view-showcase-fidelity plan.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import type {
		SingleAgentEmptyStateAgentInputModel,
		SingleAgentEmptyStateAgentSelectorModel,
		SingleAgentEmptyStateBranchPickerModel,
		SingleAgentEmptyStateErrorCardModel,
		SingleAgentEmptyStateProjectSelectorModel,
		SingleAgentEmptyStateWorktreeCardModel,
	} from "./types.js";

	import { AgentPanelErrorCard, AgentPanelPreSessionWorktreeCard } from "../agent-panel/index.js";
	import { AgentInputView } from "../agent-input/index.js";
	import { AgentSelectorView } from "../agent-selector/index.js";
	import { BranchPickerView } from "../branch-picker/index.js";
	import { ProjectSelectorView } from "../project-selector/index.js";

	interface Props {
		// Layout & copy
		heading?: string;
		canShowInput?: boolean;
		emptyMessage?: string;

		// Visibility flags for default-rendered selectors
		showAgentSelector?: boolean;
		showProjectSelector?: boolean;
		showBranchPicker?: boolean;

		// Sub-models (drive default UI shell rendering)
		errorCard?: SingleAgentEmptyStateErrorCardModel;
		worktreeCard?: SingleAgentEmptyStateWorktreeCardModel;
		agentSelector?: SingleAgentEmptyStateAgentSelectorModel;
		projectSelector?: SingleAgentEmptyStateProjectSelectorModel;
		branchPicker?: SingleAgentEmptyStateBranchPickerModel;
		agentInput?: SingleAgentEmptyStateAgentInputModel;

		// Snippet overrides — when provided, replace default rendering
		errorCardOverride?: Snippet;
		worktreeCardOverride?: Snippet;
		selectorOverride?: Snippet;
		composerOverride?: Snippet;
		branchPickerOverride?: Snippet;
	}

	let {
		heading = "What do you want to build?",
		canShowInput = true,
		emptyMessage = "No agents or projects available.",
		showAgentSelector = true,
		showProjectSelector = true,
		showBranchPicker = true,
		errorCard = undefined,
		worktreeCard = undefined,
		agentSelector = undefined,
		projectSelector = undefined,
		branchPicker = undefined,
		agentInput = undefined,
		errorCardOverride = undefined,
		worktreeCardOverride = undefined,
		selectorOverride = undefined,
		composerOverride = undefined,
		branchPickerOverride = undefined,
	}: Props = $props();

	const hasDefaultSelectors = $derived(
		(showAgentSelector && agentSelector !== undefined) ||
			(showProjectSelector && projectSelector !== undefined)
	);
</script>

<div
	class="flex flex-col items-center justify-center h-full w-full py-12"
	data-testid="single-agent-empty-state"
>
	<h1
		class="mb-8 text-center font-sans text-[1.9rem] font-semibold tracking-tight text-foreground sm:text-4xl"
	>
		{heading}
	</h1>

	<div class="flex w-full max-w-[29.4rem] flex-col px-6">
		{#if canShowInput}
			<div class="w-full">
				<!-- Error Card -->
				{#if errorCardOverride}
					{@render errorCardOverride()}
				{:else if errorCard}
					<div class="mb-3">
						<AgentPanelErrorCard
							title={errorCard.title}
							summary={errorCard.summary}
							details={errorCard.details}
							referenceId={errorCard.referenceId}
							referenceSearchable={errorCard.referenceSearchable ?? false}
							issueActionLabel={errorCard.issueActionLabel}
							onDismiss={errorCard.onDismiss}
							onCopyReferenceId={errorCard.onCopyReferenceId}
							onIssueAction={errorCard.onIssueAction}
							onRetry={errorCard.onRetry}
						/>
					</div>
				{/if}

				<!-- Worktree Card -->
				{#if worktreeCardOverride}
					{@render worktreeCardOverride()}
				{:else if worktreeCard}
					<div class="mb-2">
						<AgentPanelPreSessionWorktreeCard
							label={worktreeCard.label ?? "Worktree"}
							yesLabel={worktreeCard.yesLabel ?? "Yes"}
							noLabel={worktreeCard.noLabel ?? "No"}
							alwaysLabel={worktreeCard.alwaysLabel ?? "Remember"}
							pendingWorktreeEnabled={worktreeCard.pendingWorktreeEnabled}
							alwaysEnabled={worktreeCard.alwaysEnabled ?? false}
							failureMessage={worktreeCard.failureMessage ?? null}
							onYes={worktreeCard.onYes}
							onNo={worktreeCard.onNo}
							onAlways={worktreeCard.onAlways}
							onDismiss={worktreeCard.onDismiss}
							onRetry={worktreeCard.onRetry}
						/>
					</div>
				{/if}

				<!-- Selector Row (agent + project) -->
				{#if selectorOverride}
					{@render selectorOverride()}
				{:else if hasDefaultSelectors}
					<div class="mb-2 flex items-center gap-1">
						{#if showAgentSelector && agentSelector}
							<AgentSelectorView
								agents={agentSelector.agents}
								selectedAgentId={agentSelector.selectedAgentId}
								onSelect={agentSelector.onSelect}
								onToggleFavorite={agentSelector.onToggleFavorite}
							/>
						{/if}
						{#if showAgentSelector && agentSelector && showProjectSelector && projectSelector}
							<div class="h-full w-px bg-border/50"></div>
						{/if}
						{#if showProjectSelector && projectSelector}
							<ProjectSelectorView
								selectedProject={projectSelector.selectedProject}
								recentProjects={projectSelector.recentProjects}
								onSelect={projectSelector.onSelect}
								onBrowse={projectSelector.onBrowse}
							/>
						{/if}
					</div>
				{/if}

				<!-- Composer -->
				{#if composerOverride}
					{@render composerOverride()}
				{:else if agentInput}
					<AgentInputView
						placeholder={agentInput.placeholder}
						value={agentInput.value}
						agentPills={agentInput.agentPills}
						contextPills={agentInput.contextPills}
						showAttachButton={agentInput.showAttachButton}
						showVoiceButton={agentInput.showVoiceButton}
						showExpandButton={agentInput.showExpandButton}
						isSending={agentInput.isSending}
						disabled={agentInput.disabled}
						onSend={agentInput.onSend}
						onAttach={agentInput.onAttach}
						onVoice={agentInput.onVoice}
						onExpand={agentInput.onExpand}
						onInput={agentInput.onInput}
						onRemoveAgentPill={agentInput.onRemoveAgentPill}
						onRemoveContextPill={agentInput.onRemoveContextPill}
					/>
				{/if}

				<!-- Branch Picker -->
				{#if branchPickerOverride}
					{@render branchPickerOverride()}
				{:else if showBranchPicker && branchPicker}
					<div class="mt-2 flex h-7 items-center">
						<div class="ml-auto h-full min-w-0 w-fit max-w-[12rem]">
							<BranchPickerView
								currentBranch={branchPicker.currentBranch}
								diffStats={branchPicker.diffStats}
								branches={branchPicker.branches}
								isNotGitRepo={branchPicker.isNotGitRepo}
								canInitGitRepo={branchPicker.canInitGitRepo}
								variant={branchPicker.variant ?? "minimal"}
								onSelectBranch={branchPicker.onSelectBranch}
								onInitGitRepo={branchPicker.onInitGitRepo}
							/>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<p class="text-muted-foreground text-sm">{emptyMessage}</p>
		{/if}
	</div>
</div>
