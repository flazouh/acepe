<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";
	interface Props {
		active?: boolean;
		class?: string;
		"data-testid"?: string;
	}

	let {
		active = false,
		class: className = "",
		"data-testid": dataTestId,
	}: Props = $props();

	// Icon-swap recipe (transitions.dev 09-icon-swap): the outline and filled
	// pins share one grid cell and cross-fade with opacity/transform — 250ms
	// ease-in-out, scale from 0.25, will-change, and a prefers-reduced-motion
	// guard. Deliberately NO blur/filter: a 14px pin under blur() reads as a
	// fuzzy blob at full opacity. The reveal fires ONLY when the pointer is over
	// the pin button itself (group-hover/pin) or the button gains keyboard focus
	// (group-focus-visible/pin) — never on row-wide hover/keyboard-highlight.
	const layerBase =
		"[grid-area:1/1] size-3.5 transition-[opacity,transform] duration-[250ms] ease-in-out will-change-[opacity,transform] motion-reduce:transition-none";
	const outlineLayer =
		"opacity-100 scale-100 group-hover/pin:opacity-0 group-hover/pin:scale-[0.25] group-focus-visible/pin:opacity-0 group-focus-visible/pin:scale-[0.25]";
	const filledLayer =
		"opacity-0 scale-[0.25] group-hover/pin:opacity-100 group-hover/pin:scale-100 group-focus-visible/pin:opacity-100 group-focus-visible/pin:scale-100";
</script>

{#if active}
	<HugeiconsIcon
		name="pin"
		class="default-agent-pin-filled size-3.5 {className}"
		style="color: inherit;"
		data-testid={dataTestId ?? "default-agent-pin-active-icon"}
	/>
{:else}
	<span class="default-agent-pin-swap relative inline-grid size-3.5 {className}">
		<HugeiconsIcon
			name="pin"
			class="default-agent-pin-outline {layerBase} {outlineLayer}"
			style="color: inherit;"
			data-testid={dataTestId ?? "default-agent-pin-icon"}
		/>
		<HugeiconsIcon
			name="pin"
			class="default-agent-pin-filled {layerBase} {filledLayer}"
			style="color: inherit;"
		/>
	</span>
{/if}

<style>
	/* The filled layer reuses the pin glyph as a solid silhouette. */
	:global(.default-agent-pin-filled path) {
		fill: currentColor;
	}
</style>
