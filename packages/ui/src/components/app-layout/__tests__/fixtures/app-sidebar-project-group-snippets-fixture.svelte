<script lang="ts">
	import AppSidebarProjectGroup from "../../app-sidebar-project-group.svelte";

	interface Props {
		expanded: boolean;
	}

	let { expanded }: Props = $props();
</script>

<AppSidebarProjectGroup projectName="Acepe">
	{#snippet header()}
		<button type="button">Acepe project</button>
	{/snippet}
	{#snippet children()}
		{#if expanded}
			<div>Session task</div>
		{/if}
	{/snippet}
</AppSidebarProjectGroup>
