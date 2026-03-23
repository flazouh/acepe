<script lang="ts">
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
	import Keyboard from "phosphor-svelte/lib/Keyboard";
	import Warning from "phosphor-svelte/lib/Warning";
	import IconHammer from "@tabler/icons-svelte/icons/hammer";
	import type { SectionedFeedSectionId } from "./types.js";

	import { Colors } from "../../lib/colors.js";

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
			<span class="shrink-0 hammering">
				<IconHammer class="size-3" style="fill: {color};" />
			</span>
		{:else if sectionId === "planning"}
			<IconHammer class="size-3 shrink-0" style="fill: {color};" />
		{:else if sectionId === "finished"}
			<CheckCircle class="size-3 shrink-0" weight="fill" style="color: {color}" />
		{:else if sectionId === "error"}
			<Warning class="size-3 shrink-0" weight="fill" style="color: {color}" />
		{/if}
		{label}
	</span>
	<span class="font-mono text-[10px] text-muted-foreground/50 tabular-nums">{count}</span>
</div>

<style>
	@keyframes hammer {
		0%, 100% {
			transform: rotate(0deg);
		}
		30% {
			transform: rotate(-20deg);
		}
		50% {
			transform: rotate(25deg);
		}
		60% {
			transform: rotate(25deg);
		}
	}

	.hammering {
		display: inline-flex;
		transform-origin: 35% 65%;
		animation: hammer 1s ease-in-out infinite;
	}
</style>
