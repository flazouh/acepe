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
	}

	let { sectionId, label, count }: Props = $props();
</script>

<div class="flex items-center gap-1.5 px-2 py-1">
	{#if sectionId === "answer_needed"}
		<Keyboard class="size-3 shrink-0 text-primary" weight="fill" />
	{:else if sectionId === "working"}
		<span class="shrink-0 hammering" style="color: {Colors.purple}">
			<IconHammer class="size-3" style="fill: {Colors.purple};" />
		</span>
	{:else if sectionId === "finished"}
		<CheckCircle class="size-3 shrink-0 text-success" weight="fill" />
	{:else if sectionId === "error"}
		<Warning class="size-3 shrink-0 text-primary" weight="fill" />
	{/if}
	<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
		{label}
	</span>
	<span class="text-[10px] text-muted-foreground/60 tabular-nums">
		{count}
	</span>
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
