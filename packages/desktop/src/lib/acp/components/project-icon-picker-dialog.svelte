<script lang="ts">
import { Button } from "$lib/components/ui/button/index.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { convertIconPath } from "../logic/project-client.js";

interface Props {
	open: boolean;
	projectPath: string;
	images: string[];
	onSelect: (iconPath: string) => void;
	onBrowse: () => void;
	onOpenChange: (open: boolean) => void;
}

let { open, projectPath, images, onSelect, onBrowse, onOpenChange }: Props = $props();

function relativePath(absolutePath: string): string {
	if (absolutePath.startsWith(projectPath)) {
		const rel = absolutePath.slice(projectPath.length);
		return rel.startsWith("/") ? rel.slice(1) : rel;
	}
	return absolutePath;
}

function handleSelect(imagePath: string) {
	onSelect(imagePath);
	onOpenChange(false);
}
</script>

<DialogFrame
	{open}
	title="Choose Project Icon"
	closeLabel="Close project icon picker"
	size="medium"
	contentOverflow="hidden"
	{onOpenChange}
>
	<div class="flex min-h-0 flex-1 flex-col px-3 py-2">
		<p class="pb-2 text-[12px] text-muted-foreground">
			Select an image from your project or browse for a custom one.
		</p>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if images.length === 0}
				<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
					No images found in this project.
				</div>
			{:else}
				<div class="grid grid-cols-4 gap-2">
					{#each images as imagePath (imagePath)}
						{@const src = convertIconPath(imagePath)}
						{@const label = relativePath(imagePath)}
						<button
							type="button"
							class="group flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent p-2 transition-colors hover:border-border hover:bg-accent/50"
							title={label}
							onclick={() => handleSelect(imagePath)}
						>
							<div
								class="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md bg-muted/30"
							>
								{#if src}
									<img
										{src}
										alt={label}
										class="max-h-full max-w-full object-contain"
										draggable="false"
									/>
								{/if}
							</div>
							<span
								class="w-full truncate text-center text-[9px] leading-tight text-muted-foreground"
							>
								{label}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#snippet footer()}
		<Button variant="outline" size="sm" onclick={onBrowse}>Browse files…</Button>
		<Button variant="outline" size="sm" onclick={() => onOpenChange(false)}>Cancel</Button>
	{/snippet}
</DialogFrame>
