<script lang="ts">
	import { NumberCircleOne } from "../icons/index.js";
	import { NumberCircleTwo } from "../icons/index.js";
	import { NumberCircleThree } from "../icons/index.js";
	import { NumberCircleFour } from "../icons/index.js";
	import { NumberCircleFive } from "../icons/index.js";
	import { NumberCircleSix } from "../icons/index.js";
	import { NumberCircleSeven } from "../icons/index.js";
	import { NumberCircleEight } from "../icons/index.js";
	import { NumberCircleNine } from "../icons/index.js";
	import { CheckCircle } from "../icons/index.js";
	import { CircleNotch } from "../icons/index.js";
	import { XCircle } from "../icons/index.js";
	import { Circle } from "../icons/index.js";

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
