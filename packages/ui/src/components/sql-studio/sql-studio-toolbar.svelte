<script lang="ts">
	import HardDrives from "phosphor-svelte/lib/HardDrives";
	import Play from "phosphor-svelte/lib/Play";
	import { cn } from "../../lib/utils.js";

	interface Props {
		selectedTableLabel: string | null;
		pendingEditCount: number;
		isSaving: boolean;
		sqlEditorOpen: boolean;
		isExecutingQuery: boolean;
		hasConnection: boolean;
		lastInfo: string | null;
		onSaveEdits: () => void;
		onDiscardEdits: () => void;
		onToggleSqlEditor: () => void;
		onRunQuery: () => void;
		class?: string;
	}

	let {
		selectedTableLabel,
		pendingEditCount,
		isSaving,
		sqlEditorOpen,
		isExecutingQuery,
		hasConnection,
		lastInfo,
		onSaveEdits,
		onDiscardEdits,
		onToggleSqlEditor,
		onRunQuery,
		class: className,
	}: Props = $props();
</script>

<div class={cn("shrink-0 flex items-center justify-between gap-2 py-1 px-2 border-b border-border/30", className)}>
	<div class="flex items-center gap-2 min-w-0">
		{#if selectedTableLabel}
			<span class="font-mono text-[0.6875rem] font-medium text-foreground truncate">
				{selectedTableLabel}
			</span>
			<button
				type="button"
				class="h-6 px-2 rounded-md text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
				onclick={onDiscardEdits}
				disabled={pendingEditCount === 0}
			>
				Discard
			</button>
			<button
				type="button"
				class="h-6 px-2 rounded-md text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
				onclick={onSaveEdits}
				disabled={pendingEditCount === 0 || isSaving}
			>
				{isSaving ? "Saving..." : `Save (${pendingEditCount})`}
			</button>
		{:else if lastInfo}
			<span class="text-[0.625rem] text-muted-foreground">{lastInfo}</span>
		{/if}
	</div>

	<div class="flex items-center gap-1 shrink-0">
		<button
			type="button"
			class={cn(
				"h-6 px-2 rounded-md text-[0.6875rem] inline-flex items-center gap-1 transition-colors cursor-pointer",
				sqlEditorOpen
					? "bg-muted/60 text-foreground"
					: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
			)}
			onclick={onToggleSqlEditor}
		>
			<HardDrives size={12} weight="bold" />
			SQL
		</button>
		{#if sqlEditorOpen}
			<button
				type="button"
				class="h-6 px-2 rounded-md text-[0.6875rem] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
				onclick={onRunQuery}
				disabled={!hasConnection || isExecutingQuery}
			>
				<Play size={10} weight="fill" />
				{isExecutingQuery ? "Running..." : "Run"}
			</button>
		{/if}
	</div>
</div>
