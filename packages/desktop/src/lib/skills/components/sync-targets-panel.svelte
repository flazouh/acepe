<script lang="ts">
import { Checkbox } from "$lib/components/ui/checkbox/index.js";

import type { SyncTarget } from "../types/index.js";

interface Props {
	syncTargets: SyncTarget[];
	onToggle: (agentId: string, enabled: boolean) => void;
	disabled?: boolean;
}

let { syncTargets, onToggle, disabled = false }: Props = $props();

function handleToggle(agentId: string, currentEnabled: boolean) {
	if (!disabled) {
		onToggle(agentId, !currentEnabled);
	}
}

function getStatusIcon(status: string): string {
	switch (status) {
		case "synced":
			return "✓";
		case "pending":
			return "⚡";
		default:
			return "○";
	}
}

function getStatusColor(status: string): string {
	switch (status) {
		case "synced":
			return "text-success";
		case "pending":
			return "text-yellow-500";
		default:
			return "text-muted-foreground";
	}
}

function formatTimeAgo(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;

	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
	}).format(new Date(timestamp));
}

function formatSyncTime(timestamp: number | null): string {
	if (!timestamp) return "Never synced";
	return `Synced ${formatTimeAgo(timestamp)}`;
}
</script>

<div class="rounded-lg border bg-muted/30 p-3">
	<div class="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
		Sync to Agents
	</div>

	<div class="space-y-2">
		{#each syncTargets as target (target.agentId)}
			<div
				class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
			>
				<div class="flex items-center gap-2">
					<Checkbox
						checked={target.enabled}
						onCheckedChange={() => handleToggle(target.agentId, target.enabled)}
						{disabled}
						class="h-4 w-4"
					/>
					<span class="text-sm font-medium">{target.agentName}</span>
				</div>

				<div class="flex items-center gap-2 text-xs">
					<span class={getStatusColor(target.status)}>
						{getStatusIcon(target.status)}
					</span>
					<span class="text-muted-foreground">
						{#if target.enabled}
							{formatSyncTime(target.syncedAt)}
						{:else}
							Disabled
						{/if}
					</span>
				</div>
			</div>
		{/each}
	</div>
</div>
