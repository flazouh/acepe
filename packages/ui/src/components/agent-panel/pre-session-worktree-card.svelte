<script lang="ts">
	import { ArrowCounterClockwise, CheckCircle, Infinity as InfinityIcon, Tree, WarningCircle, X, XCircle } from "phosphor-svelte";
	import { Button } from "../button/index.js";

	type SelectionState = "no" | "yes" | "always";

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

	const selection: SelectionState = $derived(
		alwaysEnabled ? "always" : pendingWorktreeEnabled ? "yes" : "no"
	);

	const treeIconClass = $derived(
		selection === "always" ? "text-purple-400" : selection === "yes" ? "text-success" : "text-destructive"
	);

	const labelClass = $derived(
		selection === "no" ? "text-muted-foreground" : "text-foreground"
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
		<span class="font-medium text-[0.6875rem] {labelClass}">{label}</span>
		<div class="flex items-center gap-1.5 shrink-0" onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
			<Button variant="headerAction" size="headerAction" onclick={onAlways} aria-label={alwaysLabel}>
				<InfinityIcon size={13} weight="bold" class={selection === 'always' ? 'text-purple-400' : 'text-muted-foreground'} />
				<span class="{selection === 'always' ? '' : 'text-muted-foreground'}">{alwaysLabel}</span>
			</Button>
			<Button variant="headerAction" size="headerAction" onclick={onNo} aria-label={noLabel}>
				<XCircle size={13} weight="fill" class={selection === 'no' ? 'text-destructive' : 'text-muted-foreground'} />
				<span class="{selection === 'no' ? '' : 'text-muted-foreground'}">{noLabel}</span>
			</Button>
			<Button variant="headerAction" size="headerAction" onclick={onYes} aria-label={yesLabel}>
				<CheckCircle size={13} weight="fill" class={selection === 'yes' ? 'text-success' : 'text-muted-foreground'} />
				<span class="{selection === 'yes' ? '' : 'text-muted-foreground'}">{yesLabel}</span>
			</Button>
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
