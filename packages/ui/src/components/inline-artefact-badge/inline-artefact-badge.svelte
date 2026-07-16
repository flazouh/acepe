<script lang="ts">
	import { ChipShell } from "../chip/index.js";
	import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
	import { COLOR_NAMES, Colors } from "../../lib/colors.js";
	import { getFileIconSrc, getFallbackIconSrc } from "../../lib/file-icon/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import {
		buildInlineArtefactIconClassName,
		buildInlineArtefactLabelClassName,
	} from "./inline-artefact-badge.styles.js";

	interface Props {
		tokenType: InlineArtefactTokenType;
		label: string;
		value: string;
		charCount?: number;
		tooltip?: string;
		onclick?: (e: MouseEvent) => void;
		class?: string;
	}

	let {
		tokenType,
		label,
		value,
		charCount,
		tooltip,
		onclick,
		class: className = "",
	}: Props = $props();

	const isSlashItem = $derived(tokenType === "command" || tokenType === "skill");
	const isFile = $derived(tokenType === "file" || tokenType === "image");
	const isImageRef = $derived(tokenType === "image_ref");
	const isText = $derived(tokenType === "text" || tokenType === "text_ref");
	const isClickable = $derived(Boolean(onclick) && isFile);
	const iconSource = $derived(isImageRef ? label : value);
	const iconClassName = $derived(buildInlineArtefactIconClassName(tokenType));
	const labelClassName = $derived(buildInlineArtefactLabelClassName(tokenType));
	const slashIconColor = $derived(
		isSlashItem ? Colors[COLOR_NAMES.PURPLE] : null
	);

	function handleIconError(e: Event) {
		const img = e.target as HTMLImageElement;
		if (img) {
			img.onerror = null;
			img.src = getFallbackIconSrc();
		}
	}
</script>

{#snippet icon()}
	{#if tokenType === "command"}
		<HugeiconsIcon
			name="terminal"
			class="h-3.5 w-3.5 shrink-0 {iconClassName}"
			style={slashIconColor ? `color: ${slashIconColor};` : undefined}
		/>
	{:else if tokenType === "skill"}
		<HugeiconsIcon
			name="skills"
			class="h-3.5 w-3.5 shrink-0 {iconClassName}"
			style={slashIconColor ? `color: ${slashIconColor};` : undefined}
		/>
	{:else if tokenType === "text" || tokenType === "text_ref"}
		<HugeiconsIcon name="file-text" class="h-3.5 w-3.5 shrink-0 {iconClassName}" />
	{:else}
		<img
			src={getFileIconSrc(iconSource)}
			alt=""
			class="h-3.5 w-3.5 shrink-0 object-contain"
			aria-hidden="true"
			onerror={handleIconError}
		/>
	{/if}
{/snippet}

{#if isClickable}
	<ChipShell
		as="button"
		class={className}
		density="inline"
		title={tooltip ?? value}
		{onclick}
	>
		{@render icon()}
		<span class={labelClassName}>{label}</span>
		{#if isText && charCount !== undefined}
			<span class="text-[10px] text-muted-foreground/50">{charCount}c</span>
		{/if}
	</ChipShell>
{:else}
	<ChipShell
		class={className}
		density="inline"
		title={tooltip ?? value}
		role="img"
		ariaLabel={label}
	>
		{@render icon()}
		<span class={labelClassName}>{label}</span>
		{#if isText && charCount !== undefined}
			<span class="text-[10px] text-muted-foreground/50">{charCount}c</span>
		{/if}
	</ChipShell>
{/if}
