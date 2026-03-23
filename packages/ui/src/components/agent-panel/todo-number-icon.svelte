<script lang="ts">
	import NumberCircleOne from "phosphor-svelte/lib/NumberCircleOne";
	import NumberCircleTwo from "phosphor-svelte/lib/NumberCircleTwo";
	import NumberCircleThree from "phosphor-svelte/lib/NumberCircleThree";
	import NumberCircleFour from "phosphor-svelte/lib/NumberCircleFour";
	import NumberCircleFive from "phosphor-svelte/lib/NumberCircleFive";
	import NumberCircleSix from "phosphor-svelte/lib/NumberCircleSix";
	import NumberCircleSeven from "phosphor-svelte/lib/NumberCircleSeven";
	import NumberCircleEight from "phosphor-svelte/lib/NumberCircleEight";
	import NumberCircleNine from "phosphor-svelte/lib/NumberCircleNine";
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
	import CircleNotch from "phosphor-svelte/lib/CircleNotch";
	import XCircle from "phosphor-svelte/lib/XCircle";
	import Circle from "phosphor-svelte/lib/Circle";

	import type { AgentTodoStatus } from "./types.js";

	interface Props {
		/** 0-based index of the todo item */
		index: number;
		status: AgentTodoStatus;
		/** Whether the session is currently live/streaming */
		isLive?: boolean;
		size?: number;
		class?: string;
	}

	let { index, status, isLive = false, size = 12, class: className = "" }: Props = $props();

	const NUMBER_ICONS = [
		NumberCircleOne,
		NumberCircleTwo,
		NumberCircleThree,
		NumberCircleFour,
		NumberCircleFive,
		NumberCircleSix,
		NumberCircleSeven,
		NumberCircleEight,
		NumberCircleNine,
	];

	const numberIcon = $derived(index < 9 ? NUMBER_ICONS[index] : Circle);
	const NumberIcon = $derived(numberIcon);
</script>

{#if status === "completed"}
	<CheckCircle {size} weight="fill" class="text-success {className}" />
{:else if status === "cancelled"}
	<XCircle {size} weight="fill" class="text-muted-foreground {className}" />
{:else if status === "in_progress" && isLive}
	<CircleNotch {size} class="animate-spin text-foreground {className}" />
{:else}
	<NumberIcon {size} weight="fill" class="text-muted-foreground {className}" />
{/if}
