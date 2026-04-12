<script lang="ts">
	import { File, GlobeHemisphereWest, MagnifyingGlass, PencilSimple, ShieldWarning, Terminal, Trash } from "phosphor-svelte";

	import { FilePathBadge } from "../file-path-badge/index.js";
	import { SegmentedProgress } from "../segmented-progress/index.js";
	import type { KanbanPermissionData } from "./types.js";

	interface Props {
		permission: KanbanPermissionData;
		onApprove: () => void;
		onReject: () => void;
		onAllowAlways?: () => void;
	}

	let { permission, onApprove, onReject, onAllowAlways }: Props = $props();

	const approveLabel = $derived(permission.approveLabel ? permission.approveLabel : "Approve");
	const allowAlwaysLabel = $derived(permission.allowAlwaysLabel ? permission.allowAlwaysLabel : null);
	const rejectLabel = $derived(permission.rejectLabel ? permission.rejectLabel : "Reject");

	function handleApprove(e: MouseEvent) {
		e.stopPropagation();
		onApprove();
	}

	function handleReject(e: MouseEvent) {
		e.stopPropagation();
		onReject();
	}
</script>

<div class="mt-2 flex flex-col overflow-hidden rounded border border-border/60 bg-muted/20 shadow-sm" data-testid="kanban-permission-footer">
	<div class="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-2 py-1.5">
		<span class="inline-flex shrink-0 items-center justify-center text-primary" aria-hidden="true">
			{#if permission.toolKind === "edit"}
				<PencilSimple weight="fill" size={11} />
			{:else if permission.toolKind === "read"}
				<File weight="fill" size={11} />
			{:else if permission.toolKind === "execute"}
				<Terminal weight="fill" size={11} />
			{:else if permission.toolKind === "search"}
				<MagnifyingGlass weight="fill" size={11} />
			{:else if permission.toolKind === "fetch" || permission.toolKind === "web_search"}
				<GlobeHemisphereWest weight="fill" size={11} />
			{:else if permission.toolKind === "delete"}
				<Trash weight="fill" size={11} />
			{:else}
				<ShieldWarning weight="fill" size={10} />
			{/if}
		</span>
		<span class="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground">{permission.label}</span>
		{#if permission.progress}
			<div class="flex items-center gap-1">
				<SegmentedProgress current={permission.progress.current} total={permission.progress.total} />
				<span class="text-[10px] text-muted-foreground">
					{permission.progress.current}/{permission.progress.total}
				</span>
			</div>
		{/if}
	</div>
	<div class="flex flex-col gap-1.5 px-2.5 py-1.5">
		{#if permission.filePath}
			<FilePathBadge filePath={permission.filePath} interactive={false} />
		{/if}
		{#if permission.command}
			<code class="block whitespace-pre-wrap break-words rounded-sm bg-muted/50 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
				$ {permission.command}
			</code>
		{/if}
		<div class="mt-0.5 flex flex-wrap gap-1">
			<button
				class="flex-1 rounded-sm border border-green-600/40 bg-green-600/30 px-2 py-1 text-[10px] font-medium text-green-400 hover:bg-green-600/40 active:bg-green-600/50"
				onclick={handleApprove}
			>
				{approveLabel}
			</button>
			{#if allowAlwaysLabel && onAllowAlways}
				<button
					class="flex-1 rounded-sm border border-primary/40 bg-primary/25 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/35 active:bg-primary/45"
					onclick={(event: MouseEvent) => {
						event.stopPropagation();
						onAllowAlways();
					}}
				>
					{allowAlwaysLabel}
				</button>
			{/if}
			<button
				class="flex-1 rounded-sm border border-red-600/40 bg-red-600/30 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-600/40 active:bg-red-600/50"
				onclick={handleReject}
			>
				{rejectLabel}
			</button>
		</div>
	</div>
</div>
