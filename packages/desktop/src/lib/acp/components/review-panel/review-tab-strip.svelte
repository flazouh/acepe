<script lang="ts">
import { FilePathBadge } from "@acepe/ui";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import CircleDashed from "phosphor-svelte/lib/CircleDashed";
import XCircle from "phosphor-svelte/lib/XCircle";
import * as m from "$lib/paraglide/messages.js";

import type { ModifiedFileEntry } from "../modified-files/types/modified-file-entry.js";
import type { FileReviewStatus } from "./review-session-state.js";

interface TabItem {
	file: ModifiedFileEntry;
	index: number;
	status: FileReviewStatus;
}

interface Props {
	files: ReadonlyArray<ModifiedFileEntry>;
	selectedIndex: number;
	fileStatuses: ReadonlyArray<FileReviewStatus | undefined>;
	onSelectFile: (index: number) => void;
}

let { files, selectedIndex, fileStatuses, onSelectFile }: Props = $props();

const tabs = $derived.by((): TabItem[] =>
	files.map((file, index) => ({
		file,
		index,
		status: fileStatuses[index] ?? "partial",
	}))
);

function getStatusTooltip(status: FileReviewStatus): string {
	switch (status) {
		case "accepted":
			return m.review_status_accepted_tooltip();
		case "partial":
			return m.review_status_partial_tooltip();
		case "denied":
			return m.review_status_denied_tooltip();
		default:
			return m.review_status_partial_tooltip();
	}
}
</script>

<div class="flex overflow-x-auto min-w-0 shrink-0 scrollbar-thin" role="tablist">
	{#each tabs as { file, index, status } (file.filePath)}
		<button
			type="button"
			role="tab"
			aria-selected={selectedIndex === index}
			aria-label="{file.fileName} - {getStatusTooltip(status)}"
			class="review-tab review-tab-button inline-flex h-8 items-center gap-1.5 shrink-0 px-2 text-xs border-r border-border last:border-r-0 transition-colors {selectedIndex ===
			index
				? 'bg-accent/25 text-foreground'
				: 'text-muted-foreground hover:bg-accent/15 hover:text-foreground'}"
			onclick={() => onSelectFile(index)}
		>
			<span class="flex items-center gap-1.5 min-w-0" title={getStatusTooltip(status)}>
				{#if status === "accepted"}
					<CheckCircle class="h-3.5 w-3.5 shrink-0 text-success" weight="fill" />
				{:else if status === "denied"}
					<XCircle class="h-3.5 w-3.5 shrink-0 text-destructive" weight="fill" />
				{:else}
					<CircleDashed class="h-3.5 w-3.5 shrink-0 text-primary" weight="bold" />
				{/if}
				<span class="review-tab-chip contents">
					<FilePathBadge
						filePath={file.filePath}
						fileName={file.fileName}
						linesAdded={file.totalAdded}
						linesRemoved={file.totalRemoved}
						selected={selectedIndex === index}
						iconBasePath="/svgs/icons"
						interactive={false}
					/>
				</span>
			</span>
		</button>
	{/each}
</div>

<style>
	/* Override file chip background in tabs - keep transparent */
	.review-tab-button :global(.file-path-badge),
	.review-tab-button :global(.file-path-badge:hover),
	.review-tab-button :global(.file-path-badge-selected) {
		background: transparent !important;
	}
</style>
