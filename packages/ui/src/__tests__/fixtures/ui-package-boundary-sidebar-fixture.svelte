<script lang="ts">
	import AppSidebarLayout from "../../components/app-layout/app-sidebar-layout.svelte";
</script>

<AppSidebarLayout appVersion="0.0.0-test">
	{#snippet sessionList()}
		<div data-testid="boundary-session-list">Sessions</div>
	{/snippet}
</AppSidebarLayout>
