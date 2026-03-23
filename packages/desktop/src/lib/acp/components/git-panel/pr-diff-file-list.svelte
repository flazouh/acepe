<script lang="ts">
import { DiffPill, getFileIconSrc, getFallbackIconSrc } from "@acepe/ui";
import CaretRight from "phosphor-svelte/lib/CaretRight";

import type { FileDiff as FileDiffType } from "../../types/github-integration.js";
import PierreDiffView from "../diff-viewer/pierre-diff-view.svelte";
import { getNextExpandedPrFilePath } from "./pr-diff-expansion.js";
import PrDiffPlainTextPreview from "./pr-diff-plain-text-preview.svelte";
import { shouldUsePlainTextDiffPreview } from "./pr-diff-preview-mode.js";

interface Props {
	files: FileDiffType[];
}

let { files }: Props = $props();
let expandedFilePath = $state<string | null>(null);

function getFileName(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

function handleFileClick(filePath: string): void {
	expandedFilePath = getNextExpandedPrFilePath(expandedFilePath, filePath);
}

function handleIconError(e: Event) {
	const img = e.target as HTMLImageElement;
	if (img) {
		img.onerror = null;
		img.src = getFallbackIconSrc("/svgs/icons");
	}
}

const STATUS_LABEL: Record<string, string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
};

const STATUS_COLOR: Record<string, string> = {
	added: "text-success",
	modified: "text-warning",
	deleted: "text-destructive",
	renamed: "text-info",
};
</script>

<div class="rounded-md border border-border/30 overflow-hidden">
	{#each files as file, i (file.path)}
		{@const isExpanded = expandedFilePath === file.path}
		{@const isLast = i === files.length - 1}
		<div class={isLast ? "" : "border-b border-border/20"}>
			<button
				type="button"
				class="flex w-full items-center gap-1.5 py-1 px-2 text-left transition-colors hover:bg-muted/10"
				aria-label={file.path}
				aria-expanded={isExpanded}
				disabled={!file.patch}
				onclick={() => handleFileClick(file.path)}
			>
				<span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground/50 transition-transform" class:rotate-90={isExpanded}>
					<CaretRight size={10} weight="bold" />
				</span>
				<img
					src={getFileIconSrc(file.path, "/svgs/icons")}
					alt=""
					class="h-3.5 w-3.5 shrink-0 object-contain"
					aria-hidden="true"
					onerror={handleIconError}
				/>
				<span class="min-w-0 truncate font-mono text-[0.6875rem] leading-none text-foreground">
					{getFileName(file.path)}
				</span>
				<span class="ml-auto flex shrink-0 items-center gap-2">
					<DiffPill insertions={file.additions} deletions={file.deletions} variant="plain" />
					<span class="w-3 text-center font-mono text-[10px] font-semibold {STATUS_COLOR[file.status] ?? 'text-muted-foreground'}">
						{STATUS_LABEL[file.status] ?? "?"}
					</span>
				</span>
			</button>

			{#if isExpanded && file.patch}
				<div class="border-t border-border/20">
					{#if shouldUsePlainTextDiffPreview(file.patch)}
						<PrDiffPlainTextPreview patch={file.patch} />
					{:else}
						<PierreDiffView diff={file} viewMode="inline" />
					{/if}
				</div>
			{/if}
		</div>
	{/each}
</div>
