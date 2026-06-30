<script lang="ts">
	import { CaretDown, CaretRight } from "phosphor-svelte";
	import AgentInputSlashCommandRow from "./agent-input-slash-command-row.svelte";
	import type { AttachMenuCommandItem, AttachMenuMcpConnectionStatus } from "./agent-input-attach-menu-state.js";

	interface Props {
		id: string;
		name: string;
		status: AttachMenuMcpConnectionStatus;
		error?: string | null;
		slashItems: readonly AttachMenuCommandItem[];
		toolItems: readonly AttachMenuCommandItem[];
		expanded?: boolean;
		onToggle?: () => void;
		onItemSelect?: (item: AttachMenuCommandItem) => void;
	}

	let {
		id,
		name,
		status,
		error = null,
		slashItems,
		toolItems,
		expanded = true,
		onToggle,
		onItemSelect,
	}: Props = $props();

	const itemCount = $derived(slashItems.length + toolItems.length);

	function statusLabel(connectionStatus: AttachMenuMcpConnectionStatus): string {
		if (connectionStatus === "connected") return "Connected";
		if (connectionStatus === "failed") return "Failed";
		if (connectionStatus === "needs-auth") return "Needs auth";
		if (connectionStatus === "pending") return "Pending";
		if (connectionStatus === "disabled") return "Disabled";
		return "Unknown";
	}

	function toSlashCommand(item: AttachMenuCommandItem) {
		return {
			name: item.label,
			description: item.description ?? "",
			input: null,
		};
	}
</script>

<div class="border-t border-border/60 first:border-t-0">
	<button
		type="button"
		class="flex w-full items-center gap-2 bg-muted/20 px-2.5 py-1 text-left hover:bg-muted/30"
		aria-expanded={expanded}
		aria-controls={`mcp-server-${id}`}
		onclick={() => onToggle?.()}
	>
		{#if expanded}
			<CaretDown size={12} weight="regular" class="size-3 shrink-0 text-muted-foreground" />
		{:else}
			<CaretRight size={12} weight="regular" class="size-3 shrink-0 text-muted-foreground" />
		{/if}
		<span class="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{name}</span>
		<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
			{statusLabel(status)}
		</span>
		<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
			{itemCount}
		</span>
	</button>
	{#if expanded}
		<div id={`mcp-server-${id}`} class="flex max-h-44 flex-col overflow-y-auto py-1">
			{#if error}
				<div class="px-2.5 pb-1 text-[10px] text-destructive">{error}</div>
			{/if}
			{#each slashItems as item (item.id)}
				<AgentInputSlashCommandRow
					command={toSlashCommand(item)}
					tokenType="mcp"
					onSelect={() => onItemSelect?.(item)}
				/>
			{/each}
			{#each toolItems as item (item.id)}
				<AgentInputSlashCommandRow
					command={toSlashCommand(item)}
					tokenType="mcp"
					onSelect={() => onItemSelect?.(item)}
				/>
			{/each}
			{#if itemCount === 0}
				<div class="px-2.5 py-1.5 text-[11px] text-muted-foreground">
					No tools available yet
				</div>
			{/if}
		</div>
	{/if}
</div>
