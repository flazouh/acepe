<script lang="ts">
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
	import Eye from "phosphor-svelte/lib/Eye";
	import Keyboard from "phosphor-svelte/lib/Keyboard";
	import Warning from "phosphor-svelte/lib/Warning";
	import type { SectionedFeedSectionId } from "./types.js";

	import { BuildIcon, PlanIcon } from "../icons/index.js";

	interface Props {
		sectionId: SectionedFeedSectionId;
		label: string;
		count: number;
		color?: string;
	}

	let { sectionId, label, count, color }: Props = $props();
</script>

<div class="flex h-7 items-center justify-between border-b border-border/50 px-2">
	<span class="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
		{#if sectionId === "answer_needed"}
			<Keyboard class="size-3 shrink-0" weight="fill" style="color: {color}" />
		{:else if sectionId === "working"}
			<BuildIcon size="sm" class="shrink-0" />
		{:else if sectionId === "planning"}
			<PlanIcon size="sm" />
		{:else if sectionId === "needs_review"}
			<Eye class="size-3 shrink-0" weight="fill" style="color: {color}" />
		{:else if sectionId === "idle"}
			<CheckCircle class="size-3 shrink-0" weight="fill" style="color: {color}" />
		{:else if sectionId === "error"}
			<Warning class="size-3 shrink-0" weight="fill" style="color: {color}" />
		{/if}
		{label}
	</span>
	<span class="font-mono text-[10px] text-muted-foreground/50 tabular-nums">{count}</span>
</div>
