<script lang="ts">
import { RoundedIcon } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
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
			class="h-6 px-2 inline-flex items-center gap-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-40 disabled:pointer-events-none"
			disabled={!hasPendingHunks}
			title={"Reject file"}
			onclick={onRejectFile}
		>
			<RoundedIcon name="x-circle" class="h-3 w-3 shrink-0" style="color: {Colors.red};" />
			{"Undo"}
		</button>
		<div class="w-px bg-border/50"></div>
		<button
			type="button"
			class="h-6 px-2 inline-flex items-center gap-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-40 disabled:pointer-events-none"
			disabled={!hasPendingHunks}
			title={"Accept file"}
			onclick={onAcceptFile}
		>
			<RoundedIcon name="check-circle" class="h-3 w-3 shrink-0" style="color: {Colors.green};" />
			{"Keep File"}
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
				<RoundedIcon name="chevron-up" class="size-3 shrink-0" />
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
				<RoundedIcon name="chevron-down" class="size-3 shrink-0" />
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
				<RoundedIcon name="chevron-left" class="size-3 shrink-0" />
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
				<RoundedIcon name="chevron-right" class="size-3 shrink-0" />
			</button>
		</div>
	{/if}
</div>
