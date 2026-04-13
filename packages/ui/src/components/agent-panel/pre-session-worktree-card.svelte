<script lang="ts">
	import Tree from "@lucide/svelte/icons/git-branch-plus";
	import Folder from "@lucide/svelte/icons/folder-open";
	import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
	import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
	import AlertTriangle from "@lucide/svelte/icons/triangle-alert";

	interface Props {
		title: string;
		sessionScopeLabel: string;
		futureScopeLabel: string;
		worktreeLabel: string;
		projectRootLabel: string;
		setupCommandsLabel: string;
		setupCommandsSummary: string;
		globalDefaultEnabled: boolean;
		pendingWorktreeEnabled: boolean;
		failureMessage?: string | null;
		retryLabel?: string;
		startInProjectRootLabel?: string;
		onPendingWorktreeChange: (enabled: boolean) => void;
		onGlobalDefaultChange: (enabled: boolean) => void;
		onOpenSetupCommands: () => void;
		onRetryWorktree?: () => void;
		onStartInProjectRoot?: () => void;
	}

	let {
		title,
		sessionScopeLabel,
		futureScopeLabel,
		worktreeLabel,
		projectRootLabel,
		setupCommandsLabel,
		setupCommandsSummary,
		globalDefaultEnabled,
		pendingWorktreeEnabled,
		failureMessage = null,
		retryLabel = "Retry worktree",
		startInProjectRootLabel = "Start in project root",
		onPendingWorktreeChange,
		onGlobalDefaultChange,
		onOpenSetupCommands,
		onRetryWorktree,
		onStartInProjectRoot,
	}: Props = $props();

	function modeButtonClass(active: boolean): string {
		return active
			? "border-foreground/30 bg-foreground/10 text-foreground"
			: "border-border/60 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground";
	}
</script>

<div class="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<div class="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
				{title}
			</div>
			<div class="mt-1 text-sm text-foreground">
				{sessionScopeLabel}
			</div>
		</div>
		<div class="rounded-full border border-border/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
			{pendingWorktreeEnabled ? worktreeLabel : projectRootLabel}
		</div>
	</div>

	<div class="mt-3 grid gap-2 md:grid-cols-2">
		<button
			type="button"
			class={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${modeButtonClass(pendingWorktreeEnabled)}`}
			onclick={() => onPendingWorktreeChange(true)}
		>
			<Tree class="mt-0.5 size-4 shrink-0" />
			<span class="min-w-0">
				<span class="block text-sm font-medium">{worktreeLabel}</span>
				<span class="block text-[12px] text-muted-foreground">
					Create a dedicated workspace before first send.
				</span>
			</span>
		</button>

		<button
			type="button"
			class={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${modeButtonClass(!pendingWorktreeEnabled)}`}
			onclick={() => onPendingWorktreeChange(false)}
		>
			<Folder class="mt-0.5 size-4 shrink-0" />
			<span class="min-w-0">
				<span class="block text-sm font-medium">{projectRootLabel}</span>
				<span class="block text-[12px] text-muted-foreground">
					Start directly in the project root.
				</span>
			</span>
		</button>
	</div>

	<div class="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
		<div class="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
			<div class="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
				{futureScopeLabel}
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={globalDefaultEnabled}
				class={`mt-2 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[12px] transition-colors ${globalDefaultEnabled ? "border-foreground/30 bg-foreground/10 text-foreground" : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground"}`}
				onclick={() => onGlobalDefaultChange(!globalDefaultEnabled)}
			>
				<span
					class={`h-2.5 w-2.5 rounded-full ${globalDefaultEnabled ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
				></span>
				<span>{globalDefaultEnabled ? "Automatic worktrees on" : "Automatic worktrees off"}</span>
			</button>
		</div>

		<button
			type="button"
			class="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-border"
			onclick={onOpenSetupCommands}
			title={setupCommandsLabel}
		>
			<SlidersHorizontal class="size-4 shrink-0 text-muted-foreground" />
			<span class="min-w-0">
				<span class="block text-sm">{setupCommandsLabel}</span>
				<span class="block text-[12px] text-muted-foreground">{setupCommandsSummary}</span>
			</span>
		</button>
	</div>

	{#if failureMessage}
		<div class="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
			<div class="flex items-start gap-2">
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-destructive" />
				<div class="min-w-0 flex-1">
					<div class="text-sm font-medium text-foreground">Worktree launch failed</div>
					<div class="mt-1 text-[12px] text-muted-foreground">{failureMessage}</div>
				</div>
			</div>
			<div class="mt-3 flex flex-wrap gap-2">
				{#if onRetryWorktree}
					<button
						type="button"
						class="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background"
						onclick={onRetryWorktree}
					>
						<RotateCcw class="size-3.5" />
						<span>{retryLabel}</span>
					</button>
				{/if}
				{#if onStartInProjectRoot}
					<button
						type="button"
						class="inline-flex items-center gap-2 rounded-md border border-border/60 bg-background/70 px-3 py-1.5 text-[12px] font-medium text-foreground"
						onclick={onStartInProjectRoot}
					>
						<Folder class="size-3.5" />
						<span>{startInProjectRootLabel}</span>
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>
