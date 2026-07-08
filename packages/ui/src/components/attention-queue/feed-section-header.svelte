<script lang="ts">
	import { RoundedIcon } from "../icons/index.js";
	import type { Snippet } from "svelte";
	import type { SectionedFeedSectionId } from "./types.js";

interface Props {
	sectionId: SectionedFeedSectionId;
	label: string;
	count: number;
	color?: string;
	needsReviewIcon?: "eye" | "file-code";
	actions?: Snippet<[SectionedFeedSectionId]>;
}

let { sectionId, label, count, color, needsReviewIcon = "eye", actions }: Props = $props();
</script>

{#snippet pulseIcon(testId: string, active: boolean)}
	<span
		class="relative inline-flex size-3 shrink-0 items-center justify-center {active ? '' : 'opacity-75'}"
		style="color: {color}"
		data-testid={testId}
		aria-hidden="true"
	>
		<span class="absolute left-0 top-[6px] h-px w-[3px] rounded-full bg-current"></span>
		<span class="absolute left-[2px] top-[5px] h-px w-[4px] -rotate-[58deg] rounded-full bg-current"></span>
		<span class="absolute left-[5px] top-[5px] h-px w-[4px] rotate-[58deg] rounded-full bg-current"></span>
		<span class="absolute left-[8px] top-[6px] h-px w-[4px] rounded-full bg-current"></span>
	</span>
{/snippet}

<div class="flex h-7 items-center justify-between px-2">
	<span class="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground/70">
		{#if sectionId === "answer_needed"}
			<RoundedIcon name="keyboard" class="size-3 shrink-0" style="color: {color}" />
		{:else if sectionId === "working"}
			{@render pulseIcon("feed-section-working-pulse-icon", true)}
		{:else if sectionId === "planning"}
			{@render pulseIcon("feed-section-planning-pulse-icon", false)}
		{:else if sectionId === "needs_review"}
			{#if needsReviewIcon === "file-code"}
				<RoundedIcon name="code" class="size-3 shrink-0" style="color: {color}" data-testid="feed-section-code-icon" />
			{:else}
				<RoundedIcon name="eye" class="size-3 shrink-0" style="color: {color}" data-testid="feed-section-eye-icon" />
			{/if}
		{:else if sectionId === "idle"}
			<RoundedIcon name="check-circle" class="size-3 shrink-0" style="color: {color}" />
		{:else if sectionId === "error"}
			<RoundedIcon name="warning" class="size-3 shrink-0" style="color: {color}" />
		{/if}
		{label}
	</span>
	<div class="flex items-center gap-1">
		{#if actions}
			<div class="flex items-center">
				{@render actions(sectionId)}
			</div>
		{/if}
		<span class="font-mono text-[10px] text-muted-foreground/50 tabular-nums">{count}</span>
	</div>
</div>
