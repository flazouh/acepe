<script lang="ts">
	import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
	import { getFileIconSrc, getFallbackIconSrc } from "../../lib/file-icon/index.js";

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
	const isText = $derived(tokenType === "text" || tokenType === "text_ref");
	const isClickable = $derived(Boolean(onclick) && isFile);
	const maxWidthClass = $derived(isSlashItem ? "max-w-[180px]" : "max-w-[120px]");
	const baseClassName = $derived(
		`inline-flex items-center gap-1 p-1 rounded-md bg-muted text-[11px] align-middle ${className}`.trim()
	);
	const interactiveClassName = $derived(
		`${baseClassName} ${isClickable ? "cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors" : ""}`.trim()
	);

	const PACKAGE_PATH =
		"M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.35,44L178.57,92.29l-80.35-44Zm0,88L47.65,76,81.56,57.43l80.35,44Zm88,55.85h0l-80,43.79V133.83l32-17.51V152a8,8,0,0,0,16,0V107.56l32-17.51v85.76Z";
	const CLIPBOARD_PATH =
		"M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm32,128H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm0-32H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Z";

	function handleIconError(e: Event) {
		const img = e.target as HTMLImageElement;
		if (img) {
			img.onerror = null;
			img.src = getFallbackIconSrc();
		}
	}
</script>

{#snippet icon()}
	{#if isSlashItem}
		<svg viewBox="0 0 256 256" fill="currentColor" class="h-3.5 w-3.5 shrink-0" aria-hidden="true">
			<path d={PACKAGE_PATH} />
		</svg>
	{:else if tokenType === "text" || tokenType === "text_ref"}
		<svg
			viewBox="0 0 256 256"
			fill="currentColor"
			class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
			aria-hidden="true"
		>
			<path d={CLIPBOARD_PATH} />
		</svg>
	{:else}
		<img
			src={getFileIconSrc(value)}
			alt=""
			class="h-3.5 w-3.5 shrink-0 object-contain"
			aria-hidden="true"
			onerror={handleIconError}
		/>
	{/if}
{/snippet}

{#if isClickable}
	<button
		type="button"
		class={interactiveClassName}
		title={tooltip ?? value}
		{onclick}
	>
		{@render icon()}
		<span class="{maxWidthClass} truncate {isSlashItem ? 'font-mono' : ''} text-foreground leading-none">{label}</span>
		{#if isText && charCount !== undefined}
			<span class="text-[10px] text-muted-foreground/50">{charCount}c</span>
		{/if}
	</button>
{:else}
	<span
		class={baseClassName}
		title={tooltip ?? value}
		role="img"
		aria-label={label}
	>
		{@render icon()}
		<span class="{maxWidthClass} truncate {isSlashItem ? 'font-mono' : ''} text-foreground leading-none">{label}</span>
		{#if isText && charCount !== undefined}
			<span class="text-[10px] text-muted-foreground/50">{charCount}c</span>
		{/if}
	</span>
{/if}
