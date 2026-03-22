<script lang="ts">
import FileText from "@lucide/svelte/icons/file-text";
import X from "@lucide/svelte/icons/x";
import FileIcon from "$lib/components/ui/file-icon/file-icon.svelte";
import * as Popover from "$lib/components/ui/popover/index.js";

import type { Attachment } from "../agent-input/types/attachment.js";

import ArtefactPreview from "./artefact-preview.svelte";

interface Props {
	attachment: Attachment;
	onRemove?: () => void;
}

const { attachment, onRemove }: Props = $props();

let isOpen = $state(false);

function handleRemove(e: MouseEvent) {
	e.stopPropagation();
	onRemove?.();
}

// Dynamic sizing based on content type
const popoverClass = $derived.by(() => {
	if (attachment.type === "image") {
		// Images: auto-size with max constraints, no overflow scroll
		return "p-1 rounded-lg";
	}
	// Text/files: fixed size with scroll
	return "w-[400px] h-[300px] overflow-auto p-0 rounded-lg";
});
</script>

<Popover.Root bind:open={isOpen}>
	<Popover.Trigger
		class="cursor-pointer"
		onmouseenter={() => (isOpen = true)}
		onmouseleave={() => (isOpen = false)}
	>
		<span
			class="inline-flex items-center gap-1 p-1 rounded-md bg-muted border border-border text-xs hover:bg-muted/80 transition-colors"
		>
			{#if attachment.type === "text"}
				<FileText class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
			{:else}
				<FileIcon
					extension={attachment.type === "image" ? "png" : attachment.extension}
					class="h-3.5 w-3.5 flex-shrink-0"
				/>
			{/if}
			<span class="max-w-[120px] truncate font-mono text-foreground">
				{attachment.displayName}
			</span>
			{#if onRemove}
				<button
					type="button"
					onclick={handleRemove}
					class="ml-0.5 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer transition-colors"
					aria-label="Remove attachment"
				>
					<X class="h-3 w-3" />
				</button>
			{/if}
		</span>
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			class={popoverClass}
			onmouseenter={() => (isOpen = true)}
			onmouseleave={() => (isOpen = false)}
		>
			<ArtefactPreview {attachment} />
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
