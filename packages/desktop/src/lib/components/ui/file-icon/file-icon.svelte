<script lang="ts">
import { getFallbackIconSrc, getFileIconSrc } from "./extension-map.js";

interface Props {
	/** File extension (without dot) or icon name directly */
	extension?: string;
	/** Direct icon name (e.g., "typescript", "react") */
	name?: string;
	/** Whether folder is open (only applies to folder icons) */
	isOpen?: boolean;
	/** Additional CSS classes */
	class?: string;
}

let { extension, name, isOpen = false, class: className = "" }: Props = $props();

const iconSrc = $derived.by(() => {
	if (name) {
		// Handle folder open state
		if (name.startsWith("folder") && isOpen && !name.includes("-open")) {
			return `/svgs/icons/${name}-open.svg`;
		}
		return `/svgs/icons/${name}.svg`;
	}
	if (extension) {
		return getFileIconSrc(extension);
	}
	return getFallbackIconSrc();
});

function handleError(event: Event) {
	const img = event.currentTarget as HTMLImageElement;
	const fallback = getFallbackIconSrc();
	if (img.src !== fallback) {
		img.src = fallback;
	}
}
</script>

<img src={iconSrc} alt="" class={className} aria-hidden="true" onerror={handleError} />
