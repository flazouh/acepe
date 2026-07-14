<script lang="ts">
	import { HugeiconsIcon as HugeiconsRenderer } from "@hugeicons/svelte";
	import {
		resolveHugeiconsIcon,
		type HugeiconsIconName,
	} from "./hugeicons-icon-registry.js";

	interface Props {
		name: HugeiconsIconName;
		size?: number;
		class?: string;
		style?: string;
		role?: string;
		"aria-label"?: string;
		"data-testid"?: string;
	}

	let {
		name,
		size = 24,
		class: className = "shrink-0",
		style,
		role,
		"aria-label": ariaLabel,
		"data-testid": dataTestid,
	}: Props = $props();

	const icon = $derived(resolveHugeiconsIcon(name));
	const resolvedRole = $derived(ariaLabel ? (role ?? "img") : role);
	const ariaHidden = $derived(ariaLabel ? undefined : "true");
</script>

<HugeiconsRenderer
	icon={icon}
	{size}
	strokeWidth={1.75}
	class={className}
	{style}
	role={resolvedRole}
	aria-label={ariaLabel}
	data-testid={dataTestid}
	aria-hidden={ariaHidden}
/>
