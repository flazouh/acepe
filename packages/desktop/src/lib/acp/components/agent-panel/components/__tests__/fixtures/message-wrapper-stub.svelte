<script lang="ts">
let { children } = $props();
</script>

<div data-testid="message-wrapper-stub">
	{@render children?.()}
</div>
