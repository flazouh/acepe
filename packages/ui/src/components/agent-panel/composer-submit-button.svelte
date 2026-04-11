<script lang="ts">
	import type { Snippet } from "svelte";
	import { IconArrowUp } from "@tabler/icons-svelte";
	import { Stop } from "phosphor-svelte";

	import { Button } from "../button/index.js";

	export type ComposerSubmitIntent = "send" | "queue" | "stop";

	interface Props {
		intent?: ComposerSubmitIntent;
		disabled?: boolean;
		sendLabel?: string;
		queueLabel?: string;
		stopLabel?: string;
		onclick?: () => void;
		tooltip?: Snippet;
	}

	let {
		intent = "send",
		disabled = false,
		sendLabel = "Send message",
		queueLabel = "Queue message",
		stopLabel = "Stop",
		onclick,
		tooltip,
	}: Props = $props();

	const showStop = $derived(intent === "stop");
	const ariaLabel = $derived(
		intent === "stop" ? stopLabel : intent === "queue" ? queueLabel : sendLabel
	);
</script>

{#if tooltip}
	{@render tooltip()}
{:else}
	<Button
		type="button"
		size="icon"
		{onclick}
		{disabled}
		title={ariaLabel}
		class="h-7 w-7 cursor-pointer shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/85"
	>
		{#if showStop}
			<Stop weight="fill" class="h-3.5 w-3.5" />
		{:else}
			<IconArrowUp class="h-3.5 w-3.5" />
		{/if}
		<span class="sr-only">{ariaLabel}</span>
	</Button>
{/if}
