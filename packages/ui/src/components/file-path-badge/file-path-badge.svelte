<script lang="ts">
	/**
	 * FilePathBadge - Dumb, presentational chip for file display.
	 * Renders icon + filename + optional diff pill. Parent passes what it has.
	 */
	import { ChipShell } from "../chip/index.js";
	import { DiffPill } from "../diff-pill/index.js";
	import { getFileIconSrc, getFallbackIconSrc } from "../../lib/file-icon/index.js";
	import { getIconBasePath } from "../../lib/icon-context.js";

	function getFileName(filePath: string): string {
		return filePath.split("/").pop() ?? filePath;
	}

	function getExtension(path: string): string {
		const filename = path.split("/").pop() ?? "";
		const dot = filename.lastIndexOf(".");
		return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
	}

	const EXTENSION_COLORS: Record<string, string> = {
		ts: "#3178c6",
		tsx: "#3178c6",
		js: "#f0db4f",
		jsx: "#f0db4f",
		svelte: "#ff3e00",
		rs: "#dea584",
		py: "#3572a5",
		json: "#cbcb41",
		md: "#83838b",
		css: "#563d7c",
		html: "#e34c26",
		toml: "#9c4221",
		yaml: "#cb171e",
		yml: "#cb171e",
	};

	type FilePathBadgeVariant = "chip" | "plain";

	interface Props {
		filePath: string;
		fileName?: string | null;
		iconBasePath?: string;
		linesAdded?: number;
		linesRemoved?: number;
		selected?: boolean;
		interactive?: boolean;
		size?: "default" | "sm";
		/** `plain` removes chip background for inline tool headers */
		variant?: FilePathBadgeVariant;
		onSelect?: () => void;
		class?: string;
	}

	let {
		filePath,
		fileName: fileNameProp,
		iconBasePath = getIconBasePath(),
		linesAdded = 0,
		linesRemoved = 0,
		selected = false,
		interactive = true,
		size = "default",
		variant = "chip",
		onSelect,
		class: className = "",
	}: Props = $props();

	const chipDensity = $derived(variant === "plain" ? "plain" : "badge");

	const isSm = $derived(size === "sm");
	const displayFileName = $derived(fileNameProp ?? getFileName(filePath));
	const showDiff = $derived(linesAdded > 0 || linesRemoved > 0);
	const useSvgIcons = $derived(Boolean(iconBasePath));
	const iconSrc = $derived(useSvgIcons ? getFileIconSrc(filePath, iconBasePath) : "");
	const fallbackIconSrc = $derived(useSvgIcons ? getFallbackIconSrc(iconBasePath) : "");
	const coloredDotColor = $derived(EXTENSION_COLORS[getExtension(filePath)] ?? "#83838b");
	const chipClassName = $derived(className ? `file-path-badge ${className}` : "file-path-badge");

	function handleIconError(e: Event) {
		const img = e.target as HTMLImageElement;
		if (img && useSvgIcons) {
			img.onerror = null;
			img.src = fallbackIconSrc;
		}
	}
</script>

{#snippet fileIcon()}
	{#if useSvgIcons}
		<img
			src={iconSrc}
			alt=""
			class="file-icon shrink-0 object-contain {isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'}"
			aria-hidden="true"
			onerror={handleIconError}
		/>
	{:else}
		<div
			class="file-icon shrink-0 rounded-sm flex items-center justify-center {isSm
				? 'h-3 w-3'
				: 'h-3.5 w-3.5'}"
			style="background: {coloredDotColor}22;"
			aria-hidden="true"
		>
			<div
				class="{isSm ? 'h-1 w-1' : 'h-1.5 w-1.5'} rounded-full"
				style="background: {coloredDotColor};"
			></div>
		</div>
	{/if}
{/snippet}

<ChipShell
	as={interactive ? "button" : "span"}
	class={chipClassName}
	dataFilePath={filePath}
	title={displayFileName}
	ariaLabel={interactive ? undefined : displayFileName}
	role={interactive ? undefined : "img"}
	density={chipDensity}
	size={size}
	selected={selected}
	interactive={interactive}
	onclick={onSelect}
>
	{@render fileIcon()}
	<span class="file-name min-w-0 truncate font-mono leading-none {isSm ? 'text-[0.625rem]' : 'text-[0.6875rem]'}"
		>{displayFileName}</span
	>
	{#if showDiff}
		<span class="file-chip-diff-pill ml-0.5 !p-0 !bg-transparent inline-flex items-center">
			<DiffPill insertions={linesAdded} deletions={linesRemoved} variant="plain" />
		</span>
	{/if}
</ChipShell>
