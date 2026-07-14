<script lang="ts">
	import { RobotIcon, HugeiconsIcon } from "../icons/index.js";
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
	<HugeiconsIcon name="tasks" class={className} style={iconStyle} />
{:else if iconKind === "autonomous"}
	<HugeiconsIcon name="shield-check" class={className} style={iconStyle} />
{:else if iconKind === "bypass"}
	<HugeiconsIcon name="shield-check" class={className} style={iconStyle} />
{:else if iconKind === "ask"}
	<HugeiconsIcon name="chat" class={className} style={iconStyle} />
{:else if iconKind === "edit"}
	<HugeiconsIcon name="edit" class={className} style={iconStyle} />
{:else if iconKind === "review"}
	<HugeiconsIcon name="review" class={className} style={iconStyle} />
{:else}
	<HugeiconsIcon name="question" class={className} style={iconStyle} />
{/if}
