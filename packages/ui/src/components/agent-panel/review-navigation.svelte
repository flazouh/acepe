<script lang="ts">
	import { Colors } from "../../lib/colors.js";
	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import { HeaderActionCell } from "../panel-header/index.js";

	interface Props {
		hunkCurrent: number;
		hunkTotal: number;
		fileCurrent: number;
		fileTotal: number;
		hasPrevHunk: boolean;
		hasNextHunk: boolean;
		hasPrevPendingFile: boolean;
		hasNextPendingFile: boolean;
		hasPendingHunks: boolean;
		showReviewNextFileCta: boolean;
		onPrevHunk: () => void;
		onNextHunk: () => void;
		onPrevFile: () => void;
		onNextFile: () => void;
		onAcceptFile: () => void;
		onRejectFile: () => void;
		onReviewNextFile: () => void;
		undoLabel?: string;
		keepLabel?: string;
		nextFileLabel?: string;
		prevHunkLabel?: string;
		nextHunkLabel?: string;
		prevFileLabel?: string;
		rejectFileTitle?: string;
		acceptFileTitle?: string;
	}

	let {
		hunkCurrent,
		hunkTotal,
		fileCurrent,
		fileTotal,
		hasPrevHunk,
		hasNextHunk,
		hasPrevPendingFile,
		hasNextPendingFile,
		hasPendingHunks,
		showReviewNextFileCta,
		onPrevHunk,
		onNextHunk,
		onPrevFile,
		onNextFile,
		onAcceptFile,
		onRejectFile,
		onReviewNextFile,
		undoLabel = "Undo",
		keepLabel = "Keep",
		nextFileLabel = "Next file",
		prevHunkLabel = "Previous hunk",
		nextHunkLabel = "Next hunk",
		prevFileLabel = "Previous file",
		rejectFileTitle = "Reject all hunks in file",
		acceptFileTitle = "Accept all hunks in file",
	}: Props = $props();

	const embeddedButtonClass =
		"h-7 inline-flex items-center justify-center px-2 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset hover:bg-accent/50 hover:text-foreground disabled:opacity-50 disabled:pointer-events-none";
</script>

<div
	class="shrink-0 flex items-center h-7 border-t border-border/50"
	role="toolbar"
	aria-label="Review controls"
>
	<div class="flex items-stretch" data-header-control>
		{#if showReviewNextFileCta}
			<button
				type="button"
				class="{embeddedButtonClass} gap-1 text-foreground"
				onclick={onReviewNextFile}
			>
				{nextFileLabel}
				<RoundedIcon name="chevron-right" class="size-3 shrink-0" />
			</button>
		{:else}
			<button
				type="button"
				class="{embeddedButtonClass} gap-1"
				disabled={!hasPendingHunks}
				title={rejectFileTitle}
				onclick={onRejectFile}
				data-header-control
			>
				<RoundedIcon name="x-circle" class="h-3 w-3 shrink-0" style="color: {Colors.red}" />
				{undoLabel}
			</button>
			<button
				type="button"
				class="{embeddedButtonClass} gap-1"
				disabled={!hasPendingHunks}
				title={acceptFileTitle}
				onclick={onAcceptFile}
				data-header-control
			>
				<RoundedIcon name="check-circle" class="h-3 w-3 shrink-0 text-success" />
				{keepLabel}
			</button>
		{/if}
	</div>

	{#if hunkTotal > 1}
		<HeaderActionCell>
			<Button
				variant="ghost"
				size="icon-chrome"
				data-header-control
				disabled={!hasPrevHunk}
				title={prevHunkLabel}
				aria-label={prevHunkLabel}
				onclick={onPrevHunk}
			>
				{#snippet children()}
					<RoundedIcon name="chevron-up" class="size-3 shrink-0" />
				{/snippet}
			</Button>
			<span
				class="h-7 inline-flex items-center justify-center px-1 text-sm tabular-nums min-w-[2rem]"
				aria-label="Hunk {hunkCurrent} of {hunkTotal}"
			>
				{hunkCurrent}/{hunkTotal}
			</span>
			<Button
				variant="ghost"
				size="icon-chrome"
				data-header-control
				disabled={!hasNextHunk}
				title={nextHunkLabel}
				aria-label={nextHunkLabel}
				onclick={onNextHunk}
			>
				{#snippet children()}
					<RoundedIcon name="chevron-down" class="size-3 shrink-0" />
				{/snippet}
			</Button>
		</HeaderActionCell>
	{/if}

	{#if fileTotal > 1}
		<HeaderActionCell>
			<Button
				variant="ghost"
				size="icon-chrome"
				data-header-control
				disabled={!hasPrevPendingFile}
				title={prevFileLabel}
				aria-label={prevFileLabel}
				onclick={onPrevFile}
			>
				{#snippet children()}
					<RoundedIcon name="chevron-left" class="size-3 shrink-0" />
				{/snippet}
			</Button>
			<span
				class="h-7 inline-flex items-center justify-center px-1 text-sm tabular-nums min-w-[2rem]"
				aria-label="File {fileCurrent} of {fileTotal}"
			>
				{fileCurrent}/{fileTotal}
			</span>
			<Button
				variant="ghost"
				size="icon-chrome"
				data-header-control
				disabled={!hasNextPendingFile}
				title={nextFileLabel}
				aria-label={nextFileLabel}
				onclick={onNextFile}
			>
				{#snippet children()}
					<RoundedIcon name="chevron-right" class="size-3 shrink-0" />
				{/snippet}
			</Button>
		</HeaderActionCell>
	{/if}
</div>
