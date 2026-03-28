<script lang="ts">
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import Bulldozer from "phosphor-svelte/lib/Bulldozer";
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
			<span class="shrink-0 bulldozing">
				<Bulldozer class="size-3" weight="fill" style="color: {color};" />
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
	@keyframes bulldozer-motion {
		0% {
			transform: translateX(0) translateY(0);
		}
		30% {
			transform: translateX(1px) translateY(0);
		}
		45% {
			transform: translateX(1px) translateY(-0.3px);
		}
		60% {
			transform: translateX(1px) translateY(0);
		}
		75% {
			transform: translateX(0.5px) translateY(-0.3px);
		}
		100% {
			transform: translateX(0) translateY(0);
		}
	}

	.bulldozing {
		display: inline-flex;
		animation: bulldozer-motion 1s ease-in-out infinite;
	}
</style>
