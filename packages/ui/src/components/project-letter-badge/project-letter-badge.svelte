<script lang="ts">
import { Colors } from "../../lib/colors.js";

interface Props {
	/** The project name to extract the first letter from */
	name?: string;
	/**
	 * Explicit badge label. When provided (e.g. a disambiguating prefix like
	 * "Ac"), it overrides the first-letter derived from {@link name}.
	 */
	label?: string | null;
	/** The color for the letter */
	color?: string;
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
	name = "",
	label = null,
	color = "#6B7280",
	iconSrc = null,
	size = 20,
	fontSize: fontSizeProp,
	sequenceId,
	showLetter = true,
	class: className = "",
}: Props = $props();

let hasError = $state(false);
let errorSrc = $state<string | null>(null);

const letter = $derived(
	label != null && label.length > 0 ? label : name.charAt(0).toUpperCase(),
);
const isMultiChar = $derived(letter.length > 1);
const hasSequenceId = $derived(sequenceId != null);
const displayColor = $derived(
	color === Colors.green ? "var(--success)" : color,
);
const iconAlt = $derived(name.length > 0 ? `${name} icon` : "Project icon");
const showImage = $derived(iconSrc && !(hasError && errorSrc === iconSrc));

const fontSize = $derived(fontSizeProp ?? size * 0.715);
const radius = $derived(size * 0.25);
const shellBg = "var(--foreground)";
const shellFg = "var(--background)";
const badgeBg = $derived(displayColor);
const badgeFg = $derived(`color-mix(in srgb, ${displayColor} 30%, black)`);
const badgeBorder = $derived(`color-mix(in srgb, ${displayColor} 30%, black)`);
</script>

<span class="inline-flex items-center {className}" style="gap: 0px;">
	{#if showImage && showLetter}
		<span
			class="inline-flex shrink-0 items-center overflow-hidden"
			style="
				height: {size}px;
				border-radius: {radius}px;
				background-color: {shellBg};
			"
		>
			<div
				class="relative flex shrink-0 items-center justify-center overflow-hidden"
				style="width: {size}px; height: {size}px;"
			>
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
			</div>
			{#if hasSequenceId}
				<span
					class="inline-flex shrink-0 items-center justify-center"
					style="height: {size}px; padding: 0 {size * 0.25}px;"
				>
					<span
						class="font-black leading-none"
						style="font-size: {fontSize}px; color: {shellFg};"
					>
						{sequenceId}
					</span>
				</span>
			{/if}
		</span>
	{:else}
		{#if showLetter}
			<div
				class="relative flex shrink-0 items-center justify-center overflow-hidden"
				style="
					background-color: {badgeBg};
					{isMultiChar ? `min-width: ${size}px; padding: 0 ${size * 0.2}px;` : `width: ${size}px;`}
					height: {size}px;
					border-radius: {hasSequenceId ? `${radius}px 0 0 ${radius}px` : `${radius}px`};
				"
			>
				<span
					class="font-black leading-none"
					style="font-size: {fontSize}px; color: {badgeFg};"
				>
					{letter}
				</span>
			</div>
		{/if}
		{#if hasSequenceId}
			<span
				class="inline-flex shrink-0 items-center justify-center"
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
				>
					{sequenceId}
				</span>
			</span>
		{/if}
	{/if}
</span>
