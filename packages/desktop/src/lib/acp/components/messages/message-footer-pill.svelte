<script lang="ts">
import CopyButton from "./copy-button.svelte";
import MessageTimestamp from "./message-timestamp.svelte";

interface Props {
	timestamp?: Date;
	model?: string;
	displayModel?: string;
	onCopy: () => void;
	copyFeedback?: boolean;
}

let { timestamp, model, displayModel, onCopy, copyFeedback = false }: Props = $props();
</script>

<!-- Compact pill footer with model, timestamp and copy button -->
<div
	class="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-border bg-accent/30"
>
	<!-- Model name -->
	{#if displayModel}
		<span class="text-xs text-muted-foreground">
			{displayModel}
		</span>
	{:else if model}
		<span class="text-xs font-mono text-muted-foreground">
			{model}
		</span>
	{/if}

	<!-- Timestamp -->
	{#if timestamp}
		<MessageTimestamp {timestamp} class="text-xs" />
	{/if}

	<!-- Copy button -->
	<CopyButton copied={copyFeedback} onClick={onCopy} variant="footer" />
</div>
