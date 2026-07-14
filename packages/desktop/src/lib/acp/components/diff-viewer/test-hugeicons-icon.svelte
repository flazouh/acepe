<script lang="ts">
	let { name, class: className = "" }: { name: string; class?: string } = $props();
</script>

<span class={className} data-testid="hugeicons-icon-stub" data-hugeicons-icon-name={name}>{name}</span>
