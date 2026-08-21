<script lang="ts">
	import type { TracerTranscriptRow } from "./tracer-transcript-state.js";

	let {
		rows,
		emptyLabel,
	}: {
		rows: ReadonlyArray<TracerTranscriptRow>;
		emptyLabel: string;
	} = $props();
</script>

<ol data-testid="tracer-transcript">
	{#if rows.length === 0}
		<li data-testid="tracer-transcript-empty">{emptyLabel}</li>
	{:else}
		{#each rows as row (row.key)}
			<li data-testid="tracer-transcript-row" data-role={row.role}>{row.text}</li>
		{/each}
	{/if}
</ol>
