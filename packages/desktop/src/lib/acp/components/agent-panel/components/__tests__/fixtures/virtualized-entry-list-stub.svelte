<script lang="ts">
let { isWaitingForResponse = false } = $props<{ isWaitingForResponse?: boolean }>();
</script>

<div
	data-testid="virtualized-entry-list-stub"
	data-waiting={isWaitingForResponse ? "true" : "false"}
></div>
