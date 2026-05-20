<!--
  Mid-session worktree switch confirmation dialog.

  Presentational only. All copy and callbacks come from the host. The host owns
  Tauri calls, session state mutations, and the move-vs-continue decision logic.

  v1 ships Continue-only as the primary action. The Move-session-changes action
  is rendered when `moveAvailable` is true but the host is expected to gate this
  behind real ownership proof; the dialog never claims safety itself.
-->
<script lang="ts">
	import * as Dialog from "../dialog/index.js";

	let {
		open = $bindable(false),
		title,
		description,
		continueLabel,
		continueHelperText,
		moveLabel,
		moveHelperText,
		cancelLabel,
		moveAvailable = false,
		moveUnavailableReason,
		otherLocalChangesMessage,
		sessionFileCount = 0,
		sessionFiles = [],
		filesHeading,
		busy = false,
		errorMessage,
		onContinue,
		onMove,
		onCancel,
	}: {
		open?: boolean;
		title: string;
		description: string;
		continueLabel: string;
		continueHelperText: string;
		moveLabel: string;
		moveHelperText?: string;
		cancelLabel: string;
		moveAvailable?: boolean;
		moveUnavailableReason?: string;
		otherLocalChangesMessage?: string;
		sessionFileCount?: number;
		sessionFiles?: readonly string[];
		filesHeading?: string;
		busy?: boolean;
		errorMessage?: string;
		onContinue: () => void;
		onMove?: () => void;
		onCancel: () => void;
	} = $props();

	let filesExpanded = $state(false);

	function handleOpenChange(next: boolean) {
		if (!next && !busy) onCancel();
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-md p-0 overflow-hidden">
		<div class="px-4 pt-4">
			<Dialog.Title class="text-base font-semibold">{title}</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground mt-1 leading-snug">
				{description}
			</Dialog.Description>
		</div>

		{#if sessionFileCount > 0}
			<div class="px-4 pt-3">
				<button
					type="button"
					class="text-xs text-muted-foreground hover:text-foreground transition-colors"
					onclick={() => (filesExpanded = !filesExpanded)}
					aria-expanded={filesExpanded}
				>
					{filesHeading ?? `${sessionFileCount} session file${sessionFileCount === 1 ? "" : "s"}`}
					<span aria-hidden="true">{filesExpanded ? "▾" : "▸"}</span>
				</button>
				{#if filesExpanded}
					<ul class="mt-2 max-h-40 overflow-auto rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs font-mono">
						{#each sessionFiles as path (path)}
							<li class="truncate" title={path}>{path}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if otherLocalChangesMessage}
			<p class="px-4 pt-2 text-xs text-muted-foreground">{otherLocalChangesMessage}</p>
		{/if}

		{#if !moveAvailable && moveUnavailableReason}
			<p class="px-4 pt-2 text-xs text-muted-foreground" aria-live="polite">
				{moveUnavailableReason}
			</p>
		{/if}

		{#if errorMessage}
			<p class="px-4 pt-2 text-xs text-destructive" role="alert" aria-live="assertive">
				{errorMessage}
			</p>
		{/if}

		<div class="mt-4 flex flex-col border-t border-border/40">
			<button
				type="button"
				class="flex flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-b border-border/30"
				onclick={onContinue}
				disabled={busy}
				autofocus
			>
				<span class="text-sm font-medium">{continueLabel}</span>
				<span class="text-xs text-muted-foreground leading-snug">{continueHelperText}</span>
			</button>

			{#if onMove}
				<button
					type="button"
					class="flex flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-b border-border/30"
					onclick={onMove}
					disabled={busy || !moveAvailable}
				>
					<span class="text-sm font-medium">{moveLabel}</span>
					{#if moveHelperText}
						<span class="text-xs text-muted-foreground leading-snug">{moveHelperText}</span>
					{/if}
				</button>
			{/if}

			<button
				type="button"
				class="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				onclick={onCancel}
				disabled={busy}
			>
				{cancelLabel}
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>
