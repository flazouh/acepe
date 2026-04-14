<script lang="ts">
	import { Colors } from "../../lib/colors.js";

	interface Props {
		/** The project name to extract the first letter from */
		name: string;
		/** The color for the letter */
		color: string;
		/** Optional project icon source. When provided, renders the image instead of the letter badge. */
		iconSrc?: string | null;
		/** Whether the badge should show a draggable grip on hover. */
		draggable?: boolean;
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
		draggable = false,
		size = 20,
		fontSize: fontSizeProp,
		sequenceId,
		showLetter = true,
		class: className = "",
	}: Props = $props();

	let hasError = $state(false);
	let errorSrc = $state<string | null>(null);

	const letter = $derived(name.charAt(0).toUpperCase());
	const hasSequenceId = $derived(sequenceId != null);
	const displayColor = $derived(color === Colors.green ? "var(--success)" : color);
	const iconAlt = $derived(name.length > 0 ? `${name} icon` : "Project icon");
	const showImage = $derived(iconSrc && !(hasError && errorSrc === iconSrc));

	const fontSize = $derived(fontSizeProp ?? size * 0.715);
	const radius = $derived(size * 0.25);
	const badgeBg = $derived(showImage ? 'var(--badge-icon-bg)' : displayColor);
	const badgeFg = $derived(showImage ? 'var(--background)' : `color-mix(in srgb, ${displayColor} 30%, black)`);
	const badgeBorder = $derived(showImage ? 'var(--badge-icon-border)' : `color-mix(in srgb, ${displayColor} 30%, black)`);
</script>

<span class="inline-flex items-center {className}" style="gap: 0px;">
	{#if showLetter}
		<div
			class="relative flex items-center justify-center shrink-0 overflow-hidden {draggable
				? 'group/project-letter-badge'
				: ''}"
			style="
				background-color: {badgeBg};
				width: {size}px;
				height: {size}px;
				border-radius: {hasSequenceId ? `${radius}px 0 0 ${radius}px` : `${radius}px`};
			"
		>
			<div
				class="absolute inset-0 flex items-center justify-center transition-opacity duration-150 ease-out motion-reduce:transition-none {draggable
					? 'opacity-100 group-hover/project-letter-badge:opacity-0'
					: ''}"
			>
				{#if showImage}
					<img
						src={iconSrc}
						alt={iconAlt}
						class="block h-full w-full object-cover"
						draggable="false"
						onerror={(e: Event) => {
							const img = e.currentTarget as HTMLImageElement;
							hasError = true;
							errorSrc = img.src;
						}}
					/>
				{:else}
					<span
						class="font-black leading-none"
						style="font-size: {fontSize}px; color: {badgeFg};"
					>
						{letter}
					</span>
				{/if}
			</div>
			{#if draggable}
				<div
					aria-hidden="true"
					class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none group-hover/project-letter-badge:opacity-100"
				>
					<span class="inline-flex h-full w-full cursor-grab items-center justify-center">
						<svg
							viewBox="0 0 8 12"
							class="h-[60%] w-[60%]"
							fill="currentColor"
							style="color: {badgeFg};"
						>
							<circle cx="2" cy="2" r="1" />
							<circle cx="6" cy="2" r="1" />
							<circle cx="2" cy="6" r="1" />
							<circle cx="6" cy="6" r="1" />
							<circle cx="2" cy="10" r="1" />
							<circle cx="6" cy="10" r="1" />
						</svg>
					</span>
				</div>
			{/if}
		</div>
	{/if}
	{#if hasSequenceId}
		<span
			class="inline-flex items-center justify-center shrink-0"
			style="
				height: {size}px;
				padding: 0 {size * 0.25}px;
				{showLetter ? `border-left: 1px solid ${badgeBorder};` : ''}
				border-radius: {showLetter ? `0 ${radius}px ${radius}px 0` : `${radius}px`};
				background-color: {badgeBg};
			"
		>
			<span
				class="font-black leading-none"
				style="font-size: {fontSize}px; color: {badgeFg};"
			>{sequenceId}</span>
		</span>
	{/if}
</span>
