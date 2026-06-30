<script lang="ts">
	import { NumberCircleOne } from "phosphor-svelte";
	import { NumberCircleTwo } from "phosphor-svelte";
	import { NumberCircleThree } from "phosphor-svelte";
	import { NumberCircleFour } from "phosphor-svelte";
	import { NumberCircleFive } from "phosphor-svelte";
	import { NumberCircleSix } from "phosphor-svelte";
	import { NumberCircleSeven } from "phosphor-svelte";
	import { NumberCircleEight } from "phosphor-svelte";
	import { NumberCircleNine } from "phosphor-svelte";
	import { CircleNotch } from "phosphor-svelte";
	import { Circle } from "phosphor-svelte";
	import { RoundedIcon } from "../icons/index.js";

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
	<RoundedIcon name="check-circle" class="text-success {className}" style="width: {size}px; height: {size}px;" />
{:else if status === "cancelled"}
	<RoundedIcon name="x-circle" class="text-muted-foreground {className}" style="width: {size}px; height: {size}px;" />
{:else if status === "in_progress" && isLive}
	<CircleNotch {size} class="animate-spin text-foreground {className}" />
{:else}
	<NumberIcon {size} weight="fill" class="text-muted-foreground {className}" />
{/if}
