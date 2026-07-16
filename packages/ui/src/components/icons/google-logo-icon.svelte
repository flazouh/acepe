<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";
	interface Props {
		class?: string;
		style?: string;
		size?: number;
		"data-testid"?: string;
	}

	let {
		class: className,
		style,
		size,
		"data-testid": dataTestId,
	}: Props = $props();

	const resolvedClass = $derived(className ?? (size === undefined ? "size-4" : ""));
	const resolvedStyle = $derived(
		`${size === undefined ? "" : `width: ${size}px; height: ${size}px;`}${style ?? ""}`
	);
</script>

<HugeiconsIcon
	name="google"
	class={resolvedClass}
	style={resolvedStyle.length === 0 ? undefined : resolvedStyle}
	data-testid={dataTestId}
/>
