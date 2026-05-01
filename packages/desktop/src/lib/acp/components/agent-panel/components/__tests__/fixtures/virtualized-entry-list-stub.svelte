<script lang="ts">
let { isWaitingForResponse = false } = $props<{ isWaitingForResponse?: boolean; sessionId?: string | null }>();
</script>

<div
	data-testid="virtualized-entry-list-stub"
	data-waiting={isWaitingForResponse ? "true" : "false"}
></div>
