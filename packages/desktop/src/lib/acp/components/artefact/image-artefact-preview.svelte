<script lang="ts">
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
	path: string;
	displayName: string;
	content?: string;
}

const { path, displayName, content }: Props = $props();

let hasError = $state(false);

// Use content (base64 data URL) if available, otherwise convert file path to asset URL
const imageSrc = $derived.by(() => {
	if (content) return content;
	if (path) return convertFileSrc(path);
	return "";
});

function handleError() {
	hasError = true;
}
</script>

{#if hasError || !imageSrc}
	<div class="flex items-center justify-center h-full p-4 text-muted-foreground">
		<span class="text-sm">Unable to load image preview</span>
	</div>
{:else}
	<img
		src={imageSrc}
		alt={displayName}
		onerror={handleError}
		class="block max-w-[500px] max-h-[400px] object-contain rounded-lg"
	/>
{/if}
