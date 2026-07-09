<script lang="ts">
	import { RobotIcon, RoundedIcon } from "../icons/index.js";
	import { getModeIconColor, type ModeIconKind } from "./agent-input-mode-selector-state.js";

	interface Props {
		iconKind: ModeIconKind;
		class?: string;
		monochrome?: boolean;
	}

	let { iconKind, class: className = "size-3.5 shrink-0", monochrome = false }: Props = $props();

	const iconWeight = $derived(monochrome ? "regular" : "fill");
	const iconStyle = $derived(monochrome ? undefined : `color: ${getModeIconColor(iconKind)}`);
</script>

{#if iconKind === "agent"}
	<RobotIcon class={className} weight={iconWeight} style={iconStyle} />
{:else if iconKind === "plan"}
	<RoundedIcon name="tasks" class={className} style={iconStyle} />
{:else if iconKind === "autonomous"}
	<RoundedIcon name="shield-check" class={className} style={iconStyle} />
{:else if iconKind === "bypass"}
	<RoundedIcon name="shield-check" class={className} style={iconStyle} />
{:else if iconKind === "ask"}
	<RoundedIcon name="chat" class={className} style={iconStyle} />
{:else if iconKind === "edit"}
	<RoundedIcon name="edit" class={className} style={iconStyle} />
{:else if iconKind === "review"}
	<RoundedIcon name="review" class={className} style={iconStyle} />
{:else}
	<RoundedIcon name="question" class={className} style={iconStyle} />
{/if}
