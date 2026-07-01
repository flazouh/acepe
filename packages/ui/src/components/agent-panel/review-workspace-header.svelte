<script lang="ts">
	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		label: string;
		closeButtonLabel?: string;
		fileCount?: number;
		selectedFileIndex?: number | null;
		showCloseButton?: boolean;
		onClose?: () => void;
		onPreviousFile?: () => void;
		onNextFile?: () => void;
	}

	let {
		closeButtonLabel = "Back",
		fileCount,
		selectedFileIndex = null,
		showCloseButton = true,
		onClose,
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
	const primaryButtonLabel = $derived(hasNextFile ? "Next" : "Done");
</script>

<div
	class="flex w-full shrink-0 items-center gap-2 px-2 py-1 {showCloseButton
		? 'justify-between'
		: 'justify-end'}"
	data-testid="review-workspace-header"
>
	{#if showCloseButton}
		<div class="flex min-w-0 items-center gap-2">
			<Button
				variant="headerAction"
				size="headerAction"
				onclick={() => onClose?.()}
				data-testid="review-workspace-close"
			>
				<RoundedIcon name="chevron-left" class="size-3 shrink-0" />
				{closeButtonLabel}
			</Button>
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

			<Button
				variant="headerAction"
				size="headerAction"
				disabled={!hasPreviousFile}
				onclick={() => onPreviousFile?.()}
				aria-label="Previous file"
				title="Previous file"
				data-testid="review-workspace-previous-file"
			>
				<RoundedIcon name="chevron-left" class="size-3" />
			</Button>

			<Button
				variant="headerAction"
				size="headerAction"
				disabled={!hasNextFile}
				onclick={() => onNextFile?.()}
				data-testid="review-workspace-next-file"
			>
				{primaryButtonLabel}
				<RoundedIcon name="arrow-left" class="size-3 rotate-180" />
			</Button>
		</div>
	{/if}
</div>
