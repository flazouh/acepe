<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";

	interface Props {
		class?: string;
		"data-testid"?: string;
	}

	let { class: className = "size-3", "data-testid": dataTestId }: Props = $props();
</script>

<HugeiconsIcon
	name="save"
	class={className}
	data-testid={dataTestId}
/>
