<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";
	interface Props {
		class?: string;
		"data-testid"?: string;
	}

	let { class: className = "size-4", "data-testid": dataTestid }: Props = $props();
</script>

<HugeiconsIcon
	name="menu"
	class={className}
	data-testid={dataTestid}
/>
