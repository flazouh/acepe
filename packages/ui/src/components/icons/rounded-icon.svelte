<script lang="ts" module>
	import {
		roundedIconData,
		resolveRoundedIconName,
		type RoundedIconName,
	} from "./rounded-icon-data.generated.js";

	export type { RoundedIconName };
</script>

<script lang="ts">
	interface Props {
		name: RoundedIconName;
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

	const icon = $derived(roundedIconData[resolveRoundedIconName(name)]);
	const resolvedRole = $derived(ariaLabel ? (role ?? "img") : role);
	const ariaHidden = $derived(ariaLabel ? undefined : "true");
</script>

<svg
	class={className}
	{style}
	role={resolvedRole}
	aria-label={ariaLabel}
	data-testid={dataTestid}
	aria-hidden={ariaHidden}
	viewBox={icon.viewBox}
	xmlns="http://www.w3.org/2000/svg"
>
	{@html icon.inner}
</svg>
