<!--
  ProjectColorSwatch - Compact color preview dot for project color pickers.
-->
<script lang="ts">
	interface Props {
		hex: string;
		size?: "sm" | "md";
	}

	let { hex, size = "sm" }: Props = $props();

	const sizeClass = $derived(size === "md" ? "size-3.5" : "size-3");
</script>

<span
	class="inline-block shrink-0 rounded-full {sizeClass} border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_0_0_1px_rgba(0,0,0,0.24)]"
	style="background-color: {hex};"
	aria-hidden="true"
></span>
