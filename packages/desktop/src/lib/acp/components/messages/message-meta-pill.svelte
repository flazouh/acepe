<script lang="ts">
/**
 * Hover-revealed widget that pairs a copy button with the message timestamp.
 *
 * Variants:
 *  - "assistant": rounded-md pill, copy on the left blended with bg, timestamp on the right.
 *  - "user": minimal flat row, copy + tiny timestamp text. Designed to sit at bottom-right
 *    inside the user message bubble.
 */
import CopyButton from "./copy-button.svelte";
import MessageTimestamp from "./message-timestamp.svelte";

interface Props {
	text?: string;
	getText?: () => string;
	timestamp?: Date | string | number;
	variant: "assistant" | "user";
	class?: string;
}

let { text, getText, timestamp, variant, class: className = "" }: Props = $props();

const isAssistant = $derived(variant === "assistant");
</script>

{#if isAssistant}
	<div
		class="inline-flex items-center rounded-lg border border-border/60 bg-background/70 backdrop-blur-sm overflow-hidden {className}"
	>
		<CopyButton
			{text}
			{getText}
			variant="embedded"
			size={13}
			class="!h-6 !w-6 rounded-none rounded-l-md"
		/>
		{#if timestamp}
			<div class="h-6 w-px bg-border/60"></div>
			<MessageTimestamp
				{timestamp}
				class="px-2 h-6 items-center text-[11px] tabular-nums text-muted-foreground"
			/>
		{/if}
	</div>
{:else}
	<div
		class="inline-flex items-center rounded-lg border border-border/60 bg-background/70 backdrop-blur-sm overflow-hidden {className}"
	>
		{#if timestamp}
			<MessageTimestamp
				{timestamp}
				class="px-2 text-[10px] tabular-nums text-muted-foreground/70"
			/>
			<div class="h-3.5 w-px bg-border/60"></div>
		{/if}
		<CopyButton
			{text}
			{getText}
			variant="embedded"
			size={12}
			class="!h-5 !w-5 rounded-none"
		/>
	</div>
{/if}
