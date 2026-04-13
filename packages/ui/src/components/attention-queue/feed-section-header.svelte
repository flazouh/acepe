<script lang="ts">
	import { CheckCircle } from "phosphor-svelte";
	import { Eye } from "phosphor-svelte";
	import { FileCode } from "phosphor-svelte";
	import { Keyboard } from "phosphor-svelte";
	import { Warning } from "phosphor-svelte";
	import type { Snippet } from "svelte";
	import type { SectionedFeedSectionId } from "./types.js";

	import { BuildIcon, PlanIcon } from "../icons/index.js";

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

<div class="flex h-7 items-center justify-between px-2">
	<span class="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground/70">
		{#if sectionId === "answer_needed"}
			<Keyboard class="size-3 shrink-0" weight="fill" style="color: {color}" />
		{:else if sectionId === "working"}
			<BuildIcon size="sm" class="shrink-0" />
		{:else if sectionId === "planning"}
			<PlanIcon size="sm" />
		{:else if sectionId === "needs_review"}
			{#if needsReviewIcon === "file-code"}
				<FileCode class="size-3 shrink-0" weight="fill" style="color: {color}" />
			{:else}
				<Eye class="size-3 shrink-0" weight="fill" style="color: {color}" />
			{/if}
		{:else if sectionId === "idle"}
			<CheckCircle class="size-3 shrink-0" weight="fill" style="color: {color}" />
		{:else if sectionId === "error"}
			<Warning class="size-3 shrink-0" weight="fill" style="color: {color}" />
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
