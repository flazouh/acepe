<script lang="ts">
	import {
		ChatCircle,
		Lightning,
		ListChecks,
		PencilSimple,
		Question,
		Robot,
		SealQuestion,
		ShieldCheck,
	} from "phosphor-svelte";

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
	<Robot class={className} weight={iconWeight} style={iconStyle} />
{:else if iconKind === "plan"}
	<ListChecks class={className} weight={iconWeight} style={iconStyle} />
{:else if iconKind === "autonomous"}
	<Lightning class={className} weight={iconWeight} style={iconStyle} />
{:else if iconKind === "bypass"}
	<ShieldCheck class={className} weight={iconWeight} style={iconStyle} />
{:else if iconKind === "ask"}
	<ChatCircle class={className} weight={iconWeight} style={iconStyle} />
{:else if iconKind === "edit"}
	<PencilSimple class={className} weight={iconWeight} style={iconStyle} />
{:else if iconKind === "review"}
	<SealQuestion class={className} weight={iconWeight} style={iconStyle} />
{:else}
	<Question class={className} weight={iconWeight} style={iconStyle} />
{/if}
