<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";
	import type { HugeiconsIconName } from "./hugeicons-icon-registry.js";

	export type InterfaceIconName = HugeiconsIconName;

	interface Props {
		name: HugeiconsIconName;
		class?: string;
		style?: string;
		role?: string;
		"aria-label"?: string;
		"data-testid"?: string;
	}

	let {
		name,
		class: className = "shrink-0",
		style,
		role,
		"aria-label": ariaLabel,
		"data-testid": dataTestid,
	}: Props = $props();
</script>

<HugeiconsIcon
	{name}
	class={className}
	{style}
	{role}
	aria-label={ariaLabel}
	data-testid={dataTestid}
/>
