<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import { EmbeddedIconButton, HeaderActionCell } from "@acepe/ui/panel-header";
import CaretDown from "phosphor-svelte/lib/CaretDown";
import CaretLeft from "phosphor-svelte/lib/CaretLeft";
import CaretRight from "phosphor-svelte/lib/CaretRight";
import CaretUp from "phosphor-svelte/lib/CaretUp";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import XCircle from "phosphor-svelte/lib/XCircle";
import * as m from "$lib/paraglide/messages.js";

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
}: Props = $props();

/** Embedded design: matches EmbeddedIconButton (h-7, no border, no rounding, hover:accent/50) */
const embeddedButtonClass =
	"h-7 inline-flex items-center justify-center px-2 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset hover:bg-accent/50 hover:text-foreground disabled:opacity-50 disabled:pointer-events-none";
</script>

<div
	class="shrink-0 flex items-center h-7 border-t border-border/50"
	role="toolbar"
	aria-label="Review controls"
>
	<!-- Undo / Keep -->
	<div class="flex items-stretch" data-header-control>
		{#if showReviewNextFileCta}
			<button
				type="button"
				class="h-7 px-2.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1"
				onclick={onReviewNextFile}
			>
				{m.review_next_file()}
				<CaretRight class="h-3 w-3" weight="fill" />
			</button>
		{:else}
			<button
				type="button"
				class="{embeddedButtonClass} gap-1"
				disabled={!hasPendingHunks}
				title={m.review_reject_file()}
				onclick={onRejectFile}
				data-header-control
			>
				<XCircle class="h-3 w-3 shrink-0" weight="fill" style="color: {Colors.red}" />
				{m.review_undo()}
			</button>
			<button
				type="button"
				class="{embeddedButtonClass} gap-1"
				disabled={!hasPendingHunks}
				title={m.review_accept_file()}
				onclick={onAcceptFile}
				data-header-control
			>
				<CheckCircle class="h-3 w-3 shrink-0 text-success" weight="fill" />
				{m.review_keep()}
			</button>
		{/if}
	</div>

	<!-- Hunk navigation: ^ current/total v -->
	{#if hunkTotal > 1}
		<HeaderActionCell>
			<EmbeddedIconButton
				disabled={!hasPrevHunk}
				title={m.review_prev_hunk()}
				ariaLabel={m.review_prev_hunk()}
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
				title={m.review_next_hunk()}
				ariaLabel={m.review_next_hunk()}
				onclick={onNextHunk}
			>
				<CaretDown class="h-3.5 w-3.5" weight="fill" />
			</EmbeddedIconButton>
		</HeaderActionCell>
	{/if}

	<!-- File navigation: < current/total > -->
	{#if fileTotal > 1}
		<HeaderActionCell>
			<EmbeddedIconButton
				disabled={!hasPrevPendingFile}
				title={m.review_prev_file()}
				ariaLabel={m.review_prev_file()}
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
				title={m.review_next_file()}
				ariaLabel={m.review_next_file()}
				onclick={onNextFile}
			>
				<CaretRight class="h-3.5 w-3.5" weight="fill" />
			</EmbeddedIconButton>
		</HeaderActionCell>
	{/if}
</div>
