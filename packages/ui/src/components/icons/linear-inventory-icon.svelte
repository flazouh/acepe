<script lang="ts" module>
	import type { LinearIconName } from "./linear-icon-catalog.js";

	export type { LinearIconName };
</script>

<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";

	interface Props {
		name: LinearIconName;
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
	name={name}
	class={className}
	{style}
	{role}
	aria-label={ariaLabel}
	data-testid={dataTestid}
/>
