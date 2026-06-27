<!--
  FusedOverflowDotsTrigger — Right-segment overflow trigger for FusedPrimaryOverflowGroup.
-->
<script lang="ts">
	import { DotsThreeVertical } from "../icons/index.js";
	import type { HTMLButtonAttributes } from "svelte/elements";

	import { cn } from "../../lib/utils.js";
	import {
		FUSED_CONTROL_OVERFLOW_BUTTON_CLASS,
		OVERFLOW_DOTS_ICON_CLASS,
	} from "./project-card-action-button-class.js";

	interface Props {
		ariaLabel: string;
		title?: string;
		class?: string;
	}

	let {
		ariaLabel,
		title,
		class: className,
		...rest
	}: Props & HTMLButtonAttributes = $props();

	const resolvedTitle = $derived(title ?? ariaLabel);
</script>

<button
	type="button"
	data-slot="button"
	data-header-control
	aria-label={ariaLabel}
	title={resolvedTitle}
	{...rest}
	class={cn(FUSED_CONTROL_OVERFLOW_BUTTON_CLASS, className)}
>
	<DotsThreeVertical class={OVERFLOW_DOTS_ICON_CLASS} weight="bold" />
</button>
