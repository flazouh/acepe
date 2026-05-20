<script lang="ts">
	import AgentPanelPermissionBar from "../../permission-bar.svelte";

	interface Props {
		attachment?: "standalone" | "tool-call";
		showSummary?: boolean;
	}

	let { attachment = "standalone", showSummary = false }: Props = $props();
</script>

<AgentPanelPermissionBar verb="Execute" filePath="src/file.ts" {attachment} {showSummary}>
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
