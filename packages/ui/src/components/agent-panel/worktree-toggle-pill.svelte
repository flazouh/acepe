<script lang="ts">
	import { Tree, WarningCircle } from "phosphor-svelte";
	import { Button } from "../button/index.js";

	interface Props {
		/** Pill label, e.g. "Worktree". */
		label: string;
		/** When true, the toggle renders in "enabled" appearance. */
		enabled: boolean;
		/** When non-null, switches to the failure variant. */
		failureMessage?: string | null;
		failureLabel?: string;
		retryLabel?: string;
		dismissLabel?: string;
		/** When true, disables the toggle (e.g. while a worktree is being created). */
		busy?: boolean;
		onToggle: () => void;
		onRetry?: () => void;
		onDismiss?: () => void;
		/** When provided, clicking the label/icon opens setup (e.g. a popover). */
		onLabelClick?: () => void;
	}

	let {
		label,
		enabled,
		failureMessage = null,
		failureLabel = "Worktree failed",
		retryLabel = "Retry",
		dismissLabel = "Dismiss",
		busy = false,
		onToggle,
		onRetry,
		onDismiss,
		onLabelClick,
	}: Props = $props();
</script>

{#if failureMessage}
	<div class="inline-flex h-7 items-center gap-1.5 px-2" data-state="failed">
		<WarningCircle size={12} weight="fill" class="shrink-0 text-destructive" />
		<span class="shrink-0 text-[0.6875rem] font-medium text-foreground">{failureLabel}</span>
		<span class="min-w-0 max-w-[180px] truncate text-[0.6875rem] text-muted-foreground"
			>{failureMessage}</span
		>
		{#if onRetry}
			<Button variant="headerAction" size="headerAction" onclick={onRetry}>
				{retryLabel}
			</Button>
		{/if}
		{#if onDismiss}
			<Button variant="headerAction" size="headerAction" onclick={onDismiss}>
				{dismissLabel}
			</Button>
		{/if}
	</div>
{:else}
	<div class="inline-flex h-7 items-center" data-state={enabled ? "on" : "off"}>
		<!-- Label area: clickable to open setup scripts when onLabelClick is provided -->
		{#if onLabelClick}
			<button
				type="button"
				onclick={onLabelClick}
				class="flex h-full items-center gap-1.5 pl-2 pr-1.5 text-xs font-mono text-muted-foreground transition-colors hover:text-foreground"
			>
				<Tree
					size={12}
					weight={enabled ? "fill" : "regular"}
					class="shrink-0 {enabled ? 'text-success' : ''}"
				/>
				<span class="lowercase">{label}</span>
			</button>
		{:else}
			<span class="flex h-full items-center gap-1.5 pl-2 pr-1.5 text-xs font-mono text-muted-foreground">
				<Tree
					size={12}
					weight={enabled ? "fill" : "regular"}
					class="shrink-0 {enabled ? 'text-success' : ''}"
				/>
				<span class="lowercase">{label}</span>
			</span>
		{/if}
		<!-- Toggle switch -->
		<button
			type="button"
			onclick={onToggle}
			disabled={busy}
			aria-pressed={enabled}
			aria-label={label}
			class="flex h-full items-center pr-2 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<span
				class="relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors duration-200 {enabled
					? 'bg-success/80'
					: 'bg-foreground/15'}"
			>
				<span
					class="absolute h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform duration-200 {enabled
						? 'translate-x-[12px]'
						: 'translate-x-[2px]'}"
				></span>
			</span>
		</button>
	</div>
{/if}
