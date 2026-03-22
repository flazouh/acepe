<script lang="ts">
import {
	getFallbackIconSrc,
	getFileIconSrc,
	getFolderIconSrc,
	getSpecialFolderIconSrc,
} from "$lib/components/ui/file-icon/index.js";

interface Props {
	extension: string;
	isDirectory: boolean;
	isExpanded?: boolean;
	/** Folder name for specialized folder icons */
	folderName?: string;
	class?: string;
}

let {
	extension,
	isDirectory,
	isExpanded = false,
	folderName,
	class: className = "",
}: Props = $props();

const iconSrc = $derived.by(() => {
	if (isDirectory) {
		if (folderName) {
			return getSpecialFolderIconSrc(folderName, isExpanded);
		}
		return getFolderIconSrc(isExpanded);
	}
	return getFileIconSrc(extension);
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
