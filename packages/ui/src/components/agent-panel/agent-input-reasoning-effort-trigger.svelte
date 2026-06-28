<!--
  AgentInputReasoningEffortTrigger - Shared brain icon + composerChipIcon shell for reasoning effort.
  Used by config-option composer controls. Model-variant picker uses FusedPrimaryOverflowGroup directly.
-->
<script lang="ts">
	import { Brain } from "phosphor-svelte";
	import type { Snippet } from "svelte";

	import { Selector } from "../selector/index.js";
	import {
		REASONING_EFFORT_BRAIN_ICON_CLASS,
		REASONING_EFFORT_SELECTOR_SIDE_OFFSET,
		REASONING_EFFORT_SELECTOR_TRIGGER_SIZE,
		REASONING_EFFORT_SELECTOR_VARIANT,
	} from "./agent-input-reasoning-effort-trigger-props.js";

	interface Props {
		children: Snippet;
		disabled?: boolean;
		open?: boolean;
		onOpenChange?: (isOpen: boolean) => void;
		embeddedInGroup?: boolean;
		align?: "start" | "center" | "end";
		side?: "top" | "right" | "bottom" | "left";
		sideOffset?: number;
		triggerAriaLabel?: string;
		tooltipTitle?: string;
		tooltipDescription?: string;
		tooltipSide?: "top" | "right" | "bottom" | "left";
		iconStyle?: string;
	}

	let {
		children,
		disabled = false,
		open = $bindable(false),
		onOpenChange,
		embeddedInGroup = false,
		align = "start",
		side = "top",
		sideOffset = REASONING_EFFORT_SELECTOR_SIDE_OFFSET,
		triggerAriaLabel,
		tooltipTitle,
		tooltipDescription,
		tooltipSide = "top",
		iconStyle = "",
	}: Props = $props();
</script>

<Selector
	{disabled}
	bind:open
	{onOpenChange}
	{embeddedInGroup}
	{align}
	{side}
	{sideOffset}
	variant={REASONING_EFFORT_SELECTOR_VARIANT}
	triggerSize={REASONING_EFFORT_SELECTOR_TRIGGER_SIZE}
	showChevron={false}
	{triggerAriaLabel}
	{tooltipTitle}
	{tooltipDescription}
	{tooltipSide}
>
	{#snippet renderButton()}
		<Brain
			class={REASONING_EFFORT_BRAIN_ICON_CLASS}
			weight="fill"
			aria-hidden="true"
			style={iconStyle}
		/>
	{/snippet}

	{@render children()}
</Selector>
