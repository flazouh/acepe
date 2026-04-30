<script lang="ts">
import * as Dialog from "@acepe/ui/dialog";

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

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
		<Dialog.Header class="px-4 pt-4 pb-2">
			<Dialog.Title class="text-sm font-semibold">Choose Project Icon</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				Select an image from your project or browse for a custom one.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
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
							<div class="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md bg-muted/30">
								{#if src}
									<img
										{src}
										alt={label}
										class="max-h-full max-w-full object-contain"
										draggable="false"
									/>
								{/if}
							</div>
							<span class="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
								{label}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
		<div class="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
			<button
				type="button"
				class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				onclick={onBrowse}
			>
				Browse files…
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				onclick={() => onOpenChange(false)}
			>
				Cancel
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>
