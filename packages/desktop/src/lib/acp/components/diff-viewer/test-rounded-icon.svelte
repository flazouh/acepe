<script lang="ts">
let { name, class: className = "" }: { name: string; class?: string } = $props();
</script>

<span class={className} data-testid="rounded-icon-stub">{name}</span>
