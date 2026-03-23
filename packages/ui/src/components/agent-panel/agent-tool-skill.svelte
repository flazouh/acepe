<script lang="ts">
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import Package from "phosphor-svelte/lib/Package";
	import Check from "phosphor-svelte/lib/Check";
	import { TextShimmer } from "../text-shimmer/index.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolLabel from "./tool-label.svelte";
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

	const isPending = $derived(status === "pending" || status === "running");
	const isSuccess = $derived(status === "done");
	const hasDescription = $derived(Boolean(description && description.trim().length > 0));
	const hasContent = $derived(hasDescription);

	// Format display name: /skillName
	const displayName = $derived(skillName ? `/${skillName}` : null);

	// Truncate args for header display
	const displayArgs = $derived(
		skillArgs && skillArgs.length > 40 ? skillArgs.slice(0, 40) + "..." : skillArgs
	);

	function toggleExpand() {
		isExpanded = !isExpanded;
	}
</script>

<AgentToolCard>
	{#if isPending && !skillName}
		<!-- Loading state: skill name not yet streamed -->
		<div class="flex h-7 items-start gap-1.5 px-2.5 py-0.5">
			<div class="flex min-w-0 flex-1 items-center gap-1.5">
				<ToolLabel {status}>
					{loadingLabel}
				</ToolLabel>
			</div>
		</div>
	{:else if !skillName}
		<!-- No skill name -->
		<div class="flex h-7 items-center px-2.5">
			<span class="text-xs text-muted-foreground">{fallbackLabel}</span>
		</div>
	{:else}
		<!-- Header - fixed height -->
		<div class="flex h-7 items-center justify-between gap-2 px-2.5">
			<!-- Left side: icon + skill name + args -->
			<div class="flex min-w-0 flex-1 items-center gap-1.5">
				<Package weight="duotone" size={14} class="shrink-0 text-primary" />

				{#if isPending}
					<TextShimmer class="shrink-0 font-mono text-xs font-medium text-foreground">
						{displayName}
					</TextShimmer>
				{:else}
					<span class="shrink-0 font-mono text-xs font-medium text-foreground">
						{displayName}
					</span>
				{/if}

				{#if displayArgs}
					<span class="truncate font-mono text-[10px] text-muted-foreground/70">
						{displayArgs}
					</span>
				{/if}
			</div>

			<!-- Right side: status + expand button -->
			<div class="flex shrink-0 items-center gap-2">
				{#if durationLabel}
					<span class="font-mono text-[10px] text-muted-foreground/70">{durationLabel}</span>
				{/if}
				<!-- Status indicator -->
				<div class="flex items-center gap-1 text-xs text-muted-foreground">
					{#if isPending}
						<ToolLabel {status}>{runningStatusLabel}</ToolLabel>
					{:else if isSuccess}
						<Check size={12} weight="bold" />
						<span class="text-[0.55rem] font-semibold tracking-[0.2em] text-muted-foreground">{doneStatusLabel}</span>
					{/if}
				</div>

				<!-- Expand/Collapse button - only show when has content -->
				{#if hasContent}
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
		{#if hasContent}
			<div
				class="border-t border-border/50"
				style="border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);"
			>
				{#if isExpanded}
					<!-- Expanded view: description -->
					<div class="px-3 py-2">
						{#if hasDescription}
							<p
								class="text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed m-0 max-h-[200px] overflow-y-auto"
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
						{#if hasDescription}
							<p class="line-clamp-2 text-left text-xs text-muted-foreground m-0">
								{description}
							</p>
						{/if}
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</AgentToolCard>
