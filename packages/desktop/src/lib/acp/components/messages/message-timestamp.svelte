<script lang="ts">
/**
 * Compact timestamp display for messages.
 * Shows time in HH:MM:SS format, with optional latency measurement.
 */

interface Props {
	timestamp?: Date | string | number;
	latencyMs?: number;
	class?: string;
}

let { timestamp, latencyMs, class: classes = "" }: Props = $props();

function formatTime(date: Date | string | number): string {
	// Handle string timestamps that are actually numbers (Unix ms)
	const value = typeof date === "string" && /^\d+$/.test(date) ? parseInt(date, 10) : date;
	const d = new Date(value);
	return d.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
}

function formatLatency(ms: number): string {
	if (ms < 1000) {
		return `${ms.toFixed(0)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}
</script>

<div class="text-xs text-muted-foreground flex items-center gap-2 {classes}">
	{#if timestamp}
		<span>{formatTime(timestamp)}</span>
	{/if}
	{#if latencyMs !== undefined}
		<span class="font-mono text-xs opacity-75">
			({formatLatency(latencyMs)})
		</span>
	{/if}
</div>
