<script lang="ts">
import FileIcon from "$lib/components/ui/file-icon/file-icon.svelte";

import type { ParsedAttachment } from "../../utils/attachment-token-parser.js";

interface Props {
	attachment: ParsedAttachment;
}

const { attachment }: Props = $props();
</script>

<span
	class="inline-flex items-center gap-1 p-1 rounded-md bg-muted border border-border text-xs"
	title={attachment.path}
>
	<FileIcon
		extension={attachment.type === "image" ? "png" : attachment.extension}
		class="h-3.5 w-3.5 flex-shrink-0"
	/>
	<span class="max-w-[120px] truncate font-mono text-foreground">{attachment.displayName}</span>
</span>
