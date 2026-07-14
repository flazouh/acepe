<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui";

interface Props {
	fileCurrent: number;
	fileTotal: number;
	isReviewed: boolean;
	hasPrevFile: boolean;
	hasNextFile: boolean;
	onToggleReviewed: () => void;
	onPrevFile: () => void;
	onNextFile: () => void;
}

let {
	fileCurrent,
	fileTotal,
	isReviewed,
	hasPrevFile,
	hasNextFile,
	onToggleReviewed,
	onPrevFile,
	onNextFile,
}: Props = $props();

const navBtnClass =
	"h-6 w-6 inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/50 disabled:opacity-40 disabled:pointer-events-none";
</script>

<div
	class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 pointer-events-auto"
	role="toolbar"
	aria-label="Review controls"
>
	<!-- Reviewed toggle -->
	<div class="flex items-stretch rounded-md overflow-hidden shadow-md border border-border/60 backdrop-blur-sm bg-popover/90">
		<button
			type="button"
			class="h-6 px-2 inline-flex items-center gap-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent/40"
			title={isReviewed ? "Mark file as not reviewed" : "Mark file reviewed"}
			onclick={onToggleReviewed}
		>
			{#if isReviewed}
				<HugeiconsIcon name="check-circle" class="h-3 w-3 shrink-0 text-success" />
				{"Reviewed"}
			{:else}
				<span class="block h-3 w-3 shrink-0 rounded-full border border-current opacity-50"></span>
				{"Mark reviewed"}
			{/if}
		</button>
	</div>

	<!-- File navigation group -->
	{#if fileTotal > 1}
		<div class="flex items-stretch rounded-md overflow-hidden shadow-md border border-border/60 backdrop-blur-sm bg-popover/90">
			<button
				type="button"
				class={navBtnClass}
				disabled={!hasPrevFile}
				title={"Previous file"}
				aria-label={"Previous file"}
				onclick={onPrevFile}
			>
				<HugeiconsIcon name="chevron-left" class="size-3 shrink-0" />
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
				disabled={!hasNextFile}
				title={"Next file"}
				aria-label={"Next file"}
				onclick={onNextFile}
			>
				<HugeiconsIcon name="chevron-right" class="size-3 shrink-0" />
			</button>
		</div>
	{/if}
</div>
