<script lang="ts">
	import AgentToolCard from "./agent-tool-card.svelte";
	import type { AgentSessionActivityEntry } from "./types.js";

	interface Props {
		entry: AgentSessionActivityEntry;
	}

	let { entry }: Props = $props();

	const statusLabel = $derived(
		entry.status === "preparing"
			? "Preparing"
			: entry.status === "usage_reset"
				? "Reset"
				: entry.status === "failed"
					? "Failed"
					: "Done"
	);
</script>

<AgentToolCard>
	<div
		class="px-2.5 py-2 text-sm text-muted-foreground"
		role="status"
		aria-label={entry.title}
		data-session-activity-kind={entry.activityKind}
		data-session-activity-status={entry.status}
	>
		<div class="flex items-center gap-2">
			<div class="font-medium text-foreground/80">{entry.title}</div>
			<div class="rounded border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground">
				{statusLabel}
			</div>
		</div>
		{#if entry.subtitle}
			<div class="mt-0.5">{entry.subtitle}</div>
		{/if}
		{#if entry.metadata !== undefined && entry.metadata.length > 0}
			<div class="mt-2 flex flex-wrap gap-1.5">
				{#each entry.metadata as item (`${item.label}:${item.value}`)}
					<div class="rounded border border-border/60 px-1.5 py-0.5 text-xs">
						<span class="text-muted-foreground/70">{item.label}</span>
						<span class="ml-1 text-foreground/75">{item.value}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</AgentToolCard>
