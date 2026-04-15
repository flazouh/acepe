<script lang="ts">
	import { ArrowCounterClockwise, CheckCircle, Tree, WarningCircle, X, XCircle } from "phosphor-svelte";
	import { Button } from "../button/index.js";
	import { SegmentedToggleGroup } from "../panel-header/index.js";

	interface Props {
		label: string;
		yesLabel: string;
		noLabel: string;
		alwaysLabel: string;
		pendingWorktreeEnabled: boolean;
		alwaysEnabled?: boolean;
		failureMessage?: string | null;
		retryLabel?: string;
		dismissLabel?: string;
		onYes: () => void;
		onNo: () => void;
		onAlways: () => void;
		onDismiss: () => void;
		onRetry?: () => void;
	}

	let {
		label,
		yesLabel,
		noLabel,
		alwaysLabel,
		pendingWorktreeEnabled,
		alwaysEnabled = false,
		failureMessage = null,
		retryLabel = "Retry",
		dismissLabel = "Dismiss",
		onYes,
		onNo,
		onAlways,
		onDismiss,
		onRetry,
	}: Props = $props();

	const worktreeOn = $derived(pendingWorktreeEnabled || alwaysEnabled);
	const toggleValue = $derived(worktreeOn ? "yes" : "no");
	const toggleItems = $derived([
		{ id: "yes", label: yesLabel },
		{ id: "no", label: noLabel },
	] as const);

	function handleToggleChange(id: string) {
		if (id === "yes") {
			onYes();
		} else {
			onNo();
		}
	}

	const treeIconClass = $derived(
		alwaysEnabled ? "text-purple-400" : worktreeOn ? "text-success" : "text-destructive"
	);
</script>

{#if failureMessage}
	<div
		class="w-full flex items-center gap-1.5 px-3 py-1 rounded-lg bg-input/30"
	>
		<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
		<span class="font-medium text-foreground text-[0.6875rem] shrink-0">Worktree failed</span>
		<span class="text-[0.6875rem] text-muted-foreground truncate min-w-0">{failureMessage}</span>
		<div class="ml-auto flex items-center gap-1.5 shrink-0" onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
			{#if onRetry}
				<Button variant="headerAction" size="headerAction" onclick={onRetry}>
					<ArrowCounterClockwise size={12} class="shrink-0" />
					{retryLabel}
				</Button>
			{/if}
			<Button variant="headerAction" size="headerAction" onclick={onDismiss}>
				{dismissLabel}
			</Button>
		</div>
	</div>
{:else}
	<div
		class="w-fit mx-auto flex items-center gap-1.5 px-3 py-1 rounded-lg bg-input/30"
	>
		<Tree size={12} weight="fill" class="shrink-0 {treeIconClass}" />
		<span class="font-medium text-[0.6875rem] text-foreground">{label}</span>

		<div class="flex items-center gap-1.5 shrink-0" onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
			<!-- Yes/No segmented toggle -->
			<SegmentedToggleGroup
				items={toggleItems}
				value={toggleValue}
				onChange={handleToggleChange}
			>
				{#snippet itemContent(item)}
					{#if item.id === "yes"}
						<CheckCircle size={12} weight={worktreeOn ? "fill" : "regular"} class={worktreeOn ? "text-success" : ""} />
					{:else}
						<XCircle size={12} weight={!worktreeOn ? "fill" : "regular"} class={!worktreeOn ? "text-destructive" : ""} />
					{/if}
					{item.label}
				{/snippet}
			</SegmentedToggleGroup>

			<!-- Remember checkbox -->
			<label class="flex items-center gap-1 cursor-pointer select-none">
				<input
					type="checkbox"
					checked={alwaysEnabled}
					onchange={onAlways}
					class="accent-current h-3 w-3"
				/>
				<span class="text-[0.625rem] text-muted-foreground">{alwaysLabel}</span>
			</label>

			<button
				type="button"
				class="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
				onclick={onDismiss}
				aria-label="Dismiss"
			>
				<X size={12} />
			</button>
		</div>
	</div>
{/if}
