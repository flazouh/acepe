<script lang="ts">
	import { Colors } from "../../lib/colors.js";

	interface Props {
		/** The project name to extract the first letter from */
		name: string;
		/** The color for the letter */
		color: string;
		/** Optional project icon source. When provided, renders the image instead of the letter badge. */
		iconSrc?: string | null;
		/** Badge size in px (default 20) */
		size?: number;
		/** Override font size in px (default: size * 0.55) */
		fontSize?: number;
		/** Per-project sequence ID. When provided, renders N to the right of the badge. */
		sequenceId?: number | null;
		/** Whether to show the project letter. Set to false to show only the sequence number. */
		showLetter?: boolean;
		/** Additional CSS classes */
		class?: string;
	}

	let {
		name,
		color,
		iconSrc = null,
		size = 20,
		fontSize: fontSizeProp,
		sequenceId,
		showLetter = true,
		class: className = "",
	}: Props = $props();

	const letter = $derived(name.charAt(0).toUpperCase());
	const hasSequenceId = $derived(sequenceId != null);
	const displayColor = $derived(color === Colors.green ? "var(--success)" : color);
	const iconAlt = $derived(name.length > 0 ? `${name} icon` : "Project icon");

	const fontSize = $derived(fontSizeProp ?? size * 0.715);
	const radius = $derived(size * 0.25);
</script>

<span class="inline-flex items-center {className}" style="gap: 0px;">
	{#if showLetter}
		<div
			class="flex items-center justify-center shrink-0 overflow-hidden"
			style="
				background-color: {displayColor};
				width: {size}px;
				height: {size}px;
				border-radius: {hasSequenceId ? `${radius}px 0 0 ${radius}px` : `${radius}px`};
			"
		>
			{#if iconSrc}
				<img
					src={iconSrc}
					alt={iconAlt}
					class="block h-full w-full object-cover"
					draggable="false"
				/>
			{:else}
				<span
					class="font-black leading-none"
					style="font-size: {fontSize}px; color: color-mix(in srgb, {displayColor} 30%, black);"
				>
					{letter}
				</span>
			{/if}
		</div>
	{/if}
	{#if hasSequenceId}
		<span
			class="inline-flex items-center justify-center shrink-0"
			style="
				height: {size}px;
				padding: 0 {size * 0.25}px;
				{showLetter ? `border-left: 1px solid color-mix(in srgb, ${displayColor} 30%, black);` : ''}
				border-radius: {showLetter ? `0 ${radius}px ${radius}px 0` : `${radius}px`};
				background-color: {displayColor};
			"
		>
			<span
				class="font-black leading-none"
				style="font-size: {fontSize}px; color: color-mix(in srgb, {displayColor} 30%, black);"
			>{sequenceId}</span>
		</span>
	{/if}
</span>
