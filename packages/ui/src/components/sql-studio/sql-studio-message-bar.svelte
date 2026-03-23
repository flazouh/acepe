<script lang="ts">
	interface Props {
		error?: string | null;
		warning?: string | null;
	}

	let { error = null, warning = null }: Props = $props();
</script>

{#if error}
	<div class="shrink-0 border-b border-destructive/20 bg-destructive/5 px-2 py-1 text-[0.6875rem] text-destructive font-mono">
		{error}
	</div>
{/if}
{#if warning}
	<div class="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[0.6875rem] text-amber-600 font-mono">
		{warning}
	</div>
{/if}
