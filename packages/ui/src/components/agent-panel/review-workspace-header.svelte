<script lang="ts">
	import { type Snippet } from "svelte";
	import { Button } from "../button/index.js";
	import { HugeiconsIcon } from "../icons/index.js";

	interface Props {
		label: string;
		headerActions?: Snippet;
		closeButtonLabel?: string;
		fileCount?: number;
		selectedFileIndex?: number | null;
		showCloseButton?: boolean;
		onClose?: () => void;
		onKeepFile?: () => void;
		onPreviousFile?: () => void;
		onNextFile?: () => void;
	}

	let {
		label,
		headerActions,
		closeButtonLabel = "Back",
		fileCount,
		selectedFileIndex = null,
		showCloseButton = true,
		onClose,
		onKeepFile,
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
	const primaryButtonLabel = $derived(onKeepFile ? "Keep" : hasNextFile ? "Next" : "Done");
	const showRightControls = $derived(headerActions !== undefined || showFileNavigation);

	function handlePrimaryFileAction(): void {
		if (onKeepFile) {
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
	aria-label={label}
	data-testid="review-workspace-header"
>
	{#if showCloseButton}
		<div class="flex min-w-0 items-center gap-2">
			<Button
				variant="secondary"
				size="xs"
				onclick={() => onClose?.()}
				data-testid="review-workspace-close"
			>
				<HugeiconsIcon name="chevron-left" class="size-3 shrink-0" />
				{closeButtonLabel}
			</Button>
		</div>
	{/if}

	{#if showRightControls}
		<div class="flex shrink-0 items-center gap-1">
			{#if headerActions}
				<div class="flex shrink-0 items-center gap-1" data-testid="review-workspace-header-actions">
					{@render headerActions()}
				</div>
			{/if}

			{#if showFileNavigation}
				<span
					class="px-1 text-xs tabular-nums text-muted-foreground"
					data-testid="review-workspace-file-position"
				>
					{filePositionLabel}
				</span>

				<Button
					variant="secondary"
					size="xs"
					disabled={!hasPreviousFile}
					onclick={() => onPreviousFile?.()}
					aria-label="Previous file"
					title="Previous file"
					data-testid="review-workspace-previous-file"
				>
					<HugeiconsIcon name="chevron-left" class="size-3" />
				</Button>

				<Button
					variant="secondary"
					size="xs"
					disabled={!onKeepFile && !hasNextFile}
					onclick={handlePrimaryFileAction}
					data-testid="review-workspace-next-file"
				>
					{primaryButtonLabel}
					<HugeiconsIcon name="arrow-left" class="size-3 rotate-180" />
				</Button>
			{/if}
		</div>
	{/if}
</div>
