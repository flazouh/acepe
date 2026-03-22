<script lang="ts">
import { DiffPill, FilePathBadge } from "@acepe/ui";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import CircleDashed from "phosphor-svelte/lib/CircleDashed";
import XCircle from "phosphor-svelte/lib/XCircle";

import type { FileReviewStatus } from "../../review-panel/review-session-state.js";
import type { ModifiedFileEntry } from "../types/modified-file-entry.js";

interface Props {
	file: ModifiedFileEntry;
	fileIndex: number;
	reviewStatus?: FileReviewStatus;
	onOpenReviewPanel: (fileIndex: number) => void;
}

let { file, fileIndex, reviewStatus, onOpenReviewPanel }: Props = $props();

const reviewIndicator = $derived.by(() => {
	if (reviewStatus === "accepted") {
		return {
			label: "Reviewed",
			icon: "accepted" as const,
			iconClassName: "text-success",
		};
	}
	if (reviewStatus === "partial") {
		return {
			label: "Partial",
			icon: "partial" as const,
			iconClassName: "text-primary",
		};
	}
	if (reviewStatus === "denied") {
		return {
			label: "Undone",
			icon: "denied" as const,
			iconClassName: "text-destructive",
		};
	}
	return {
		label: "Not reviewed",
		icon: null,
		iconClassName: "text-muted-foreground",
	};
});
</script>

<button
	type="button"
	onclick={() => onOpenReviewPanel(fileIndex)}
	class="group w-full flex items-center gap-1.5 text-[0.6875rem] py-1 px-1.5 rounded transition-colors text-left hover:bg-muted/30"
>
	<FilePathBadge
		filePath={file.filePath}
		fileName={file.fileName}
		iconBasePath="/svgs/icons"
		interactive={false}
	/>

	<span
		class="ml-auto shrink-0 text-[0.625rem] leading-none inline-flex items-center gap-1 font-mono text-foreground"
	>
		{#if reviewIndicator.icon === "accepted"}
			<CheckCircle class="h-3 w-3 shrink-0 {reviewIndicator.iconClassName}" weight="fill" />
		{:else if reviewIndicator.icon === "partial"}
			<CircleDashed class="h-3 w-3 shrink-0 {reviewIndicator.iconClassName}" weight="bold" />
		{:else if reviewIndicator.icon === "denied"}
			<XCircle class="h-3 w-3 shrink-0 {reviewIndicator.iconClassName}" weight="fill" />
		{/if}
		{reviewIndicator.label}
	</span>

	{#if file.totalAdded > 0 || file.totalRemoved > 0}
		<span class="shrink-0">
			<DiffPill insertions={file.totalAdded} deletions={file.totalRemoved} variant="plain" />
		</span>
	{/if}
</button>
