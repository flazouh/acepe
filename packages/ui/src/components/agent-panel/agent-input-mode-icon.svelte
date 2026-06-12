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
	}

	let { iconKind, class: className = "size-3.5 shrink-0" }: Props = $props();
</script>

{#if iconKind === "agent"}
	<Robot class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
{:else if iconKind === "plan"}
	<ListChecks class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
{:else if iconKind === "autonomous"}
	<Lightning class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
{:else if iconKind === "bypass"}
	<ShieldCheck class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
{:else if iconKind === "ask"}
	<ChatCircle class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
{:else if iconKind === "edit"}
	<PencilSimple class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
{:else if iconKind === "review"}
	<SealQuestion class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
{:else}
	<Question class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
{/if}
