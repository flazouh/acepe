<script lang="ts">
	import { Colors } from "../../lib/colors.js";

	interface Props {
		/** The project name to extract the first letter from */
		name: string;
		/** The color for the letter */
		color: string;
		/** Badge size in px (default 20) */
		size?: number;
		/** Override font size in px (default: size * 0.55) */
		fontSize?: number;
		/** Additional CSS classes */
		class?: string;
	}

	let { name, color, size = 20, fontSize: fontSizeProp, class: className = "" }: Props = $props();

	const letter = $derived(name.charAt(0).toUpperCase());
	const displayColor = $derived(color === Colors.green ? "var(--success)" : color);

	const fontSize = $derived(fontSizeProp ?? size * 0.715);
	const radius = $derived(size * 0.25);
</script>

<div
	class="flex items-center justify-center shrink-0 {className}"
	style="
		background-color: {displayColor};
		width: {size}px;
		height: {size}px;
		border-radius: {radius}px;
	"
>
	<span
		class="font-black leading-none"
		style="font-size: {fontSize}px; color: color-mix(in srgb, {displayColor} 30%, black);"
	>
		{letter}
	</span>
</div>
