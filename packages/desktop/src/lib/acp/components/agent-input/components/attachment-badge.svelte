<script lang="ts">
import X from "@lucide/svelte/icons/x";
import FileIcon from "$lib/components/ui/file-icon/file-icon.svelte";

import type { Attachment } from "../types/attachment.js";

interface Props {
	attachment: Attachment;
	onRemove: () => void;
	truncate?: boolean;
}

const { attachment, onRemove, truncate = true }: Props = $props();
</script>

<span class="inline-flex items-center gap-1 p-1 rounded-md bg-muted border border-border text-xs">
	<FileIcon
		extension={attachment.type === "image" ? "png" : attachment.extension}
		class="h-3.5 w-3.5 flex-shrink-0"
	/>
	<span class="{truncate ? 'max-w-[120px] truncate' : ''} font-mono text-foreground"
		>{attachment.displayName}</span
	>
	<button
		type="button"
		onclick={(e) => {
			e.stopPropagation();
			onRemove();
		}}
		class="ml-0.5 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer transition-colors"
		aria-label="Remove attachment"
	>
		<X class="h-3 w-3" />
	</button>
</span>
