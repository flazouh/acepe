<script lang="ts">
	import AgentPanelPermissionBar from "../../permission-bar.svelte";

	interface Props {
		showSummary?: boolean;
	}

	let { showSummary = false }: Props = $props();
</script>

<AgentPanelPermissionBar verb="Execute" filePath="src/file.ts" {showSummary}>
	{#snippet leading()}
		<span data-testid="permission-leading">!</span>
	{/snippet}

	{#snippet actionBar()}
		<div data-testid="permission-actions">
			<button>Deny</button>
			<button>Allow</button>
		</div>
	{/snippet}
</AgentPanelPermissionBar>
