<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import { CaretDown } from "phosphor-svelte";
import { CaretLeft } from "phosphor-svelte";
import { CaretRight } from "phosphor-svelte";
import { CaretUp } from "phosphor-svelte";
import { CheckCircle } from "phosphor-svelte";
import { XCircle } from "phosphor-svelte";
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
	onPrevHunk: () => void;
	onNextHunk: () => void;
	onPrevFile: () => void;
	onNextFile: () => void;
	onAcceptFile: () => void;
	onRejectFile: () => void;
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
	onPrevHunk,
	onNextHunk,
	onPrevFile,
	onNextFile,
	onAcceptFile,
	onRejectFile,
}: Props = $props();

const navBtnClass =
	"h-6 w-6 inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/50 disabled:opacity-40 disabled:pointer-events-none";
</script>

<div
	class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 pointer-events-auto"
	role="toolbar"
	aria-label="Review controls"
>
	<!-- Accept / Reject action group -->
	<div class="flex items-stretch rounded-md overflow-hidden shadow-md border border-border/60 backdrop-blur-sm bg-popover/90">
		<button
			type="button"
			class="h-6 px-2 inline-flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none"
			style="background: color-mix(in srgb, {Colors.red} 8%, transparent); color: {Colors.red};"
			disabled={!hasPendingHunks}
			title={"Reject file"}
			onclick={onRejectFile}
		>
			<XCircle class="h-3 w-3 shrink-0" weight="fill" />
			{"Undo"}
		</button>
		<div class="w-px bg-border/50"></div>
		<button
			type="button"
			class="h-6 px-2 inline-flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none"
			style="background: color-mix(in srgb, {Colors.green} 8%, transparent); color: {Colors.green};"
			disabled={!hasPendingHunks}
			title={"Accept file"}
			onclick={onAcceptFile}
		>
			<CheckCircle class="h-3 w-3 shrink-0" weight="fill" />
			{"Keep"}
		</button>
	</div>

	<!-- Hunk navigation group -->
	{#if hunkTotal > 1}
		<div class="flex items-stretch rounded-md overflow-hidden shadow-md border border-border/60 backdrop-blur-sm bg-popover/90">
			<button
				type="button"
				class={navBtnClass}
				disabled={!hasPrevHunk}
				title={"Previous hunk"}
				aria-label={"Previous hunk"}
				onclick={onPrevHunk}
			>
				<CaretUp class="h-3 w-3" weight="fill" />
			</button>
			<span
				class="h-6 inline-flex items-center justify-center px-1 text-[10px] tabular-nums text-muted-foreground min-w-[1.5rem]"
				aria-label="Hunk {hunkCurrent} of {hunkTotal}"
			>
				{hunkCurrent}/{hunkTotal}
			</span>
			<button
				type="button"
				class={navBtnClass}
				disabled={!hasNextHunk}
				title={"Next hunk"}
				aria-label={"Next hunk"}
				onclick={onNextHunk}
			>
				<CaretDown class="h-3 w-3" weight="fill" />
			</button>
		</div>
	{/if}

	<!-- File navigation group -->
	{#if fileTotal > 1}
		<div class="flex items-stretch rounded-md overflow-hidden shadow-md border border-border/60 backdrop-blur-sm bg-popover/90">
			<button
				type="button"
				class={navBtnClass}
				disabled={!hasPrevPendingFile}
				title={"Previous file"}
				aria-label={"Previous file"}
				onclick={onPrevFile}
			>
				<CaretLeft class="h-3 w-3" weight="fill" />
			</button>
			<span
				class="h-6 inline-flex items-center justify-center px-1 text-[10px] tabular-nums text-muted-foreground min-w-[1.5rem]"
				aria-label="File {fileCurrent} of {fileTotal}"
			>
				{fileCurrent}/{fileTotal}
			</span>
			<button
				type="button"
				class={navBtnClass}
				disabled={!hasNextPendingFile}
				title={"Next file"}
				aria-label={"Next file"}
				onclick={onNextFile}
			>
				<CaretRight class="h-3 w-3" weight="fill" />
			</button>
		</div>
	{/if}
</div>
