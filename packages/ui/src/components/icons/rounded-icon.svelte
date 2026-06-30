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
		"data-testid"?: string;
	}

	let { name, class: className = "size-4", style, "data-testid": dataTestid }: Props =
		$props();

	const icon = $derived(roundedIconData[resolveRoundedIconName(name)]);
</script>

<svg
	class={className}
	{style}
	data-testid={dataTestid}
	aria-hidden="true"
	viewBox={icon.viewBox}
	xmlns="http://www.w3.org/2000/svg"
>
	{@html icon.inner}
</svg>
