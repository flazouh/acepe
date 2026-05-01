<script lang="ts">
	import AgentToolCard from "./agent-tool-card.svelte";

	interface Props {
		title?: string | null;
		message?: string | null;
		diagnosticLabel?: string | null;
	}

	let {
		title = "Message unavailable",
		message = "This message could not be loaded.",
		diagnosticLabel = null,
	}: Props = $props();
</script>

<AgentToolCard>
	<div
		class="px-2.5 py-2 text-sm text-muted-foreground"
		role="status"
		aria-label={title ?? "Message unavailable"}
	>
		<div class="font-medium text-foreground/80">{title}</div>
		<div class="mt-0.5">{message}</div>
		{#if diagnosticLabel}
			<div class="mt-1 font-mono text-xs text-muted-foreground/60">{diagnosticLabel}</div>
		{/if}
	</div>
</AgentToolCard>
