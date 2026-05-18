<script lang="ts">
	import { ArrowRight, CaretLeft } from "phosphor-svelte";

	interface Props {
		label: string;
		closeButtonLabel?: string;
		fileCount?: number;
		selectedFileIndex?: number | null;
		showCloseButton?: boolean;
		onClose?: () => void;
		onKeepFile?: () => void;
		keepFileDisabled?: boolean;
		onPreviousFile?: () => void;
		onNextFile?: () => void;
	}

	let {
		closeButtonLabel = "Back",
		fileCount,
		selectedFileIndex = null,
		showCloseButton = true,
		onClose,
		onKeepFile,
		keepFileDisabled = false,
		onPreviousFile,
		onNextFile,
	}: Props = $props();

	const showFileNavigation = $derived(
		typeof fileCount === "number" && fileCount > 0 && selectedFileIndex !== null
	);
	const filePositionLabel = $derived(
		showFileNavigation && typeof fileCount === "number" && selectedFileIndex !== null
			? `${selectedFileIndex + 1}/${fileCount}`
			: null
	);
	const hasPreviousFile = $derived(
		showFileNavigation &&
			onPreviousFile !== undefined &&
			selectedFileIndex !== null &&
			selectedFileIndex > 0
	);
	const hasNextFile = $derived(
		showFileNavigation &&
			onNextFile !== undefined &&
			typeof fileCount === "number" &&
			selectedFileIndex !== null &&
			selectedFileIndex < fileCount - 1
	);
	const keepButtonDisabled = $derived(
		onKeepFile !== undefined ? keepFileDisabled : !hasNextFile
	);
	const primaryButtonLabel = $derived(
		onKeepFile !== undefined ? "Keep" : hasNextFile ? "Next" : "Done"
	);

	function handleKeepClick(): void {
		if (onKeepFile !== undefined) {
			onKeepFile();
			return;
		}

		onNextFile?.();
	}
</script>

<div
	class="flex w-full shrink-0 items-center gap-2 px-2 py-1 {showCloseButton
		? 'justify-between'
		: 'justify-end'}"
	data-testid="review-workspace-header"
>
	{#if showCloseButton}
		<div class="flex min-w-0 items-center gap-2">
			<button
				type="button"
				class="inline-flex h-5 items-center gap-1 rounded px-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				onclick={() => onClose?.()}
				data-testid="review-workspace-close"
			>
				<CaretLeft size={9} weight="bold" class="shrink-0" />
				{closeButtonLabel}
			</button>
		</div>
	{/if}

	{#if showFileNavigation}
		<div class="flex shrink-0 items-center gap-1">
			<span
				class="px-1 text-xs tabular-nums text-muted-foreground"
				data-testid="review-workspace-file-position"
			>
				{filePositionLabel}
			</span>

			<button
				type="button"
				class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
				disabled={!hasPreviousFile}
				onclick={() => onPreviousFile?.()}
				aria-label="Previous file"
				title="Previous file"
				data-testid="review-workspace-previous-file"
			>
				<CaretLeft size={12} weight="bold" />
			</button>

			<button
				type="button"
				class="inline-flex h-6 items-center gap-1 rounded bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
				disabled={keepButtonDisabled}
				onclick={handleKeepClick}
				data-testid="review-workspace-next-file"
			>
				{primaryButtonLabel}
				<ArrowRight size={12} weight="bold" />
			</button>
		</div>
	{/if}
</div>
