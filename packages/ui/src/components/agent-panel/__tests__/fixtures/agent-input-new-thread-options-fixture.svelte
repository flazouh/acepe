<script lang="ts">
	import AgentInputNewThreadOptions from "../../agent-input-new-thread-options.svelte";
</script>

{#snippet project()}
	<button type="button">Git review</button>
{/snippet}

{#snippet agent()}
	<button type="button">Claude Code</button>
{/snippet}

{#snippet branch()}
	<button type="button">branch</button>
{/snippet}

<AgentInputNewThreadOptions
	{project}
	{agent}
	{branch}
	worktreeOn={false}
	onWorktreeToggle={() => undefined}
	align="start"
/>
