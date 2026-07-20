<script lang="ts">
/**
 * Compact timestamp display for messages.
 * Shows time in HH:MM:SS format, with optional latency measurement.
 */

import { formatMessageLatency, formatMessageTimestamp } from "./message-timestamp-state.js";

interface Props {
	timestamp?: Date | string | number;
	latencyMs?: number;
	class?: string;
}

let { timestamp, latencyMs, class: classes = "" }: Props = $props();

const formattedTimestamp = $derived(timestamp ? formatMessageTimestamp(timestamp) : null);
const formattedLatency = $derived(latencyMs === undefined ? null : formatMessageLatency(latencyMs));
</script>

<div class="text-xs text-muted-foreground flex items-center gap-2 {classes}">
	{#if formattedTimestamp}
		<span>{formattedTimestamp}</span>
	{/if}
	{#if formattedLatency}
		<span class="font-mono text-xs opacity-75">
			({formattedLatency})
		</span>
	{/if}
</div>
