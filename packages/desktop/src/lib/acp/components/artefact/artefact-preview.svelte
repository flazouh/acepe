<script lang="ts">
import type { Attachment } from "../agent-input/types/attachment.js";

import ImageArtefactPreview from "./image-artefact-preview.svelte";
import TextArtefactPreview from "./text-artefact-preview.svelte";

interface Props {
	attachment: Attachment;
}

const { attachment }: Props = $props();
</script>

{#if attachment.type === "text" && attachment.content}
	<TextArtefactPreview content={attachment.content} />
{:else if attachment.type === "image"}
	<ImageArtefactPreview
		path={attachment.path}
		displayName={attachment.displayName}
		content={attachment.content}
	/>
{:else}
	<div class="p-3 text-sm text-muted-foreground">
		<p class="font-mono">{attachment.displayName}</p>
		<p class="text-xs mt-1">File preview not available</p>
	</div>
{/if}
