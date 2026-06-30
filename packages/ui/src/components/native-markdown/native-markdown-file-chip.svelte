<script lang="ts">
	import { buildChipShellClassName } from "../chip/index.js";
	import { getFallbackIconSrc, getFileIconSrc } from "../../lib/file-icon/index.js";
	import { getFileDisplayName, normalizeLocalFileHref } from "./native-markdown-model.js";

	interface Props {
		fileReference: string;
		onFilePathClick: (filePath: string) => void;
	}

	let { fileReference, onFilePathClick }: Props = $props();

	const normalizedFileReference = $derived(normalizeLocalFileHref(fileReference));
	const label = $derived(getFileDisplayName(normalizedFileReference));
	const chipClassName = $derived(
		buildChipShellClassName({
			density: "badge",
			interactive: true,
			className: "file-path-badge",
		}),
	);
	const iconSrc = $derived(getFileIconSrc(normalizedFileReference));

	function handleClick(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		onFilePathClick(normalizedFileReference);
	}

	function handleIconError(event: Event): void {
		if (event.currentTarget instanceof HTMLImageElement) {
			event.currentTarget.src = getFallbackIconSrc();
		}
	}
</script>

<button
	class={chipClassName}
	type="button"
	title={normalizedFileReference}
	data-file-path={normalizedFileReference}
	onclick={handleClick}
>
	<img
		src={iconSrc}
		alt=""
		class="file-icon h-3.5 w-3.5 shrink-0 object-contain"
		aria-hidden="true"
		onerror={handleIconError}
	/>
	<span class="file-name min-w-0 truncate font-mono text-[0.6875rem] leading-none">
		{label}
	</span>
</button>
