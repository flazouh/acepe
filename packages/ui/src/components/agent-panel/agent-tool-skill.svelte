<script lang="ts">
	import { CaretRight } from "phosphor-svelte";
	import { Check } from "phosphor-svelte";
	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolLabel from "./tool-label.svelte";
	import TextShimmer from "../text-shimmer/text-shimmer.svelte";
	import { LoadingIcon } from "../icons/index.js";
	import {
		getSkillDisplayArgs,
		getSkillDisplayName,
		getSkillViewState,
	} from "./agent-tool-skill-state.js";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		/** Skill name (e.g., "research", "commit") */
		skillName?: string | null;
		/** Skill arguments (truncated for header display) */
		skillArgs?: string | null;
		/** Skill description text (shown in expanded content) */
		description?: string | null;
		/** Tool status */
		status?: AgentToolStatus;
		durationLabel?: string;
		/** Label when loading (skill name not yet streamed) */
		loadingLabel?: string;
		/** Fallback label when no skill name */
		fallbackLabel?: string;
		/** Status label when running */
		runningStatusLabel?: string;
		/** Status label when done */
		doneStatusLabel?: string;
		/** Aria label for expand button */
		ariaExpandLabel?: string;
		/** Aria label for collapse button */
		ariaCollapseLabel?: string;
		/** Aria label for expand description button */
		ariaExpandDescriptionLabel?: string;
	}

	let {
		skillName,
		skillArgs,
		description,
		status = "done",
		durationLabel,
		loadingLabel = "Loading skill",
		fallbackLabel = "Skill",
		runningStatusLabel = "Running",
		doneStatusLabel = "Done",
		ariaExpandLabel = "Expand",
		ariaCollapseLabel = "Collapse",
		ariaExpandDescriptionLabel = "Expand to see full description",
	}: Props = $props();

	let isExpanded = $state(false);

	const viewState = $derived(
		getSkillViewState({ status, skillName, description })
	);
	const displayName = $derived(getSkillDisplayName(skillName));
	const displayArgs = $derived(getSkillDisplayArgs(skillArgs));

	function toggleExpand() {
		isExpanded = !isExpanded;
	}
</script>

<AgentToolCard>
	{#if viewState.showLoadingFallback}
		<!-- Loading state: skill name not yet streamed -->
		<div class="flex h-7 items-start gap-1.5 px-2.5 py-0.5">
			<div class="flex min-w-0 flex-1 items-center gap-1.5">
				<ToolLabel {status}>
					{loadingLabel}
				</ToolLabel>
			</div>
		</div>
	{:else if viewState.showMissingNameFallback}
		<!-- No skill name -->
		<div class="flex h-7 items-center px-2.5">
			<span class="text-sm">{fallbackLabel}</span>
		</div>
	{:else}
		<!-- Header - fixed height -->
		<div class="flex h-7 items-center justify-between gap-2 px-2.5">
			<!-- Left side: icon + skill name + args -->
			<div class="flex min-w-0 flex-1 items-center gap-2">
				{#if viewState.isPending}
					<LoadingIcon class="shrink-0" size={12} aria-label="Loading" />
					<TextShimmer class="shrink-0 text-sm">{displayName}</TextShimmer>
				{:else}
					<span class="shrink-0 text-sm">{displayName}</span>
				{/if}

				{#if displayArgs}
					<span class="truncate text-sm">
						{displayArgs}
					</span>
				{/if}
			</div>

			<!-- Right side: status + expand button -->
			<div class="flex shrink-0 items-center gap-2">
				{#if durationLabel}
					<span class="text-sm">{durationLabel}</span>
				{/if}
				<!-- Status indicator -->
				<div class="flex items-center gap-1 text-sm">
					{#if viewState.isPending}
						<ToolLabel {status}>{runningStatusLabel}</ToolLabel>
					{:else if viewState.isSuccess}
						<Check size={12} weight="bold" />
						<span class="text-sm">{doneStatusLabel}</span>
					{/if}
				</div>

				<!-- Expand/Collapse button - only show when has content -->
				{#if viewState.hasContent}
					<button
						type="button"
						onclick={toggleExpand}
						class="flex items-center justify-center p-1 rounded-md bg-transparent border-none text-muted-foreground cursor-pointer transition-colors hover:bg-accent active:scale-95"
						aria-label={isExpanded ? ariaCollapseLabel : ariaExpandLabel}
					>
						<CaretRight
							size={10}
							weight="bold"
							class="text-muted-foreground transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
						/>
					</button>
				{/if}
			</div>
		</div>

		<!-- Expandable content -->
		{#if viewState.hasContent}
			<div
				class="border-t border-border/50"
				style="border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);"
			>
				{#if isExpanded}
					<!-- Expanded view: description -->
					<div class="px-3 py-2">
						{#if viewState.hasDescription}
							<p
								class="m-0 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words text-sm"
							>
								{description}
							</p>
						{/if}
					</div>
				{:else}
					<!-- Collapsed view: truncated preview -->
					<button
						type="button"
						onclick={toggleExpand}
						class="block w-full px-3 py-2 bg-transparent border-none cursor-pointer text-left transition-colors hover:bg-accent/30"
						aria-label={ariaExpandDescriptionLabel}
					>
						{#if viewState.hasDescription}
							<p class="m-0 line-clamp-2 text-left text-sm">
								{description}
							</p>
						{/if}
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</AgentToolCard>
