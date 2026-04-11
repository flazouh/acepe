<script lang="ts">
	import { CaretDown, CaretLeft, CaretRight, CaretUp, CheckCircle, XCircle } from "phosphor-svelte";

	import { Colors } from "../../lib/colors.js";
	import { EmbeddedIconButton, HeaderActionCell } from "../panel-header/index.js";

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
		"h-7 inline-flex items-center justify-center px-2 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset hover:bg-accent/50 hover:text-foreground disabled:opacity-50 disabled:pointer-events-none";
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
				class="h-7 px-2.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1"
				onclick={onReviewNextFile}
			>
				{nextFileLabel}
				<CaretRight class="h-3 w-3" weight="fill" />
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
				<XCircle class="h-3 w-3 shrink-0" weight="fill" style="color: {Colors.red}" />
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
				<CheckCircle class="h-3 w-3 shrink-0 text-success" weight="fill" />
				{keepLabel}
			</button>
		{/if}
	</div>

	{#if hunkTotal > 1}
		<HeaderActionCell>
			<EmbeddedIconButton
				disabled={!hasPrevHunk}
				title={prevHunkLabel}
				ariaLabel={prevHunkLabel}
				onclick={onPrevHunk}
			>
				<CaretUp class="h-3.5 w-3.5" weight="fill" />
			</EmbeddedIconButton>
			<span
				class="h-7 inline-flex items-center justify-center px-1 text-xs tabular-nums min-w-[2rem]"
				aria-label="Hunk {hunkCurrent} of {hunkTotal}"
			>
				{hunkCurrent}/{hunkTotal}
			</span>
			<EmbeddedIconButton
				disabled={!hasNextHunk}
				title={nextHunkLabel}
				ariaLabel={nextHunkLabel}
				onclick={onNextHunk}
			>
				<CaretDown class="h-3.5 w-3.5" weight="fill" />
			</EmbeddedIconButton>
		</HeaderActionCell>
	{/if}

	{#if fileTotal > 1}
		<HeaderActionCell>
			<EmbeddedIconButton
				disabled={!hasPrevPendingFile}
				title={prevFileLabel}
				ariaLabel={prevFileLabel}
				onclick={onPrevFile}
			>
				<CaretLeft class="h-3.5 w-3.5" weight="fill" />
			</EmbeddedIconButton>
			<span
				class="h-7 inline-flex items-center justify-center px-1 text-xs tabular-nums min-w-[2rem]"
				aria-label="File {fileCurrent} of {fileTotal}"
			>
				{fileCurrent}/{fileTotal}
			</span>
			<EmbeddedIconButton
				disabled={!hasNextPendingFile}
				title={nextFileLabel}
				ariaLabel={nextFileLabel}
				onclick={onNextFile}
			>
				<CaretRight class="h-3.5 w-3.5" weight="fill" />
			</EmbeddedIconButton>
		</HeaderActionCell>
	{/if}
</div>
