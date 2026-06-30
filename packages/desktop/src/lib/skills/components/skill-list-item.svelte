<script lang="ts">
import { RoundedIcon } from "@acepe/ui";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as Tooltip from "@acepe/ui/tooltip";

import type { LibrarySkillWithSync } from "../types/index.js";

interface Props {
	skill: LibrarySkillWithSync;
	isSelected: boolean;
	onSelect: (skillId: string) => void;
	pendingCount: number;
	lastSyncTime: string;
	syncStatus: "synced" | "pending" | "syncing" | "never";
}

const { skill, isSelected, onSelect, pendingCount, lastSyncTime, syncStatus }: Props = $props();

// Truncate description to 1-2 lines
function truncateDescription(desc: string | null, maxLength: number = 60): string {
	if (!desc) return "";
	return desc.length > maxLength ? `${desc.slice(0, maxLength)}...` : desc;
}

const truncatedDesc = $derived(truncateDescription(skill.skill.description));

// Determine sync status icon and tooltip text
const syncStatusInfo = $derived.by(() => {
	switch (syncStatus) {
		case "syncing":
			return {
				tooltip: "Syncing...",
				classes: "text-muted-foreground",
			};
		case "synced":
			return {
				tooltip: lastSyncTime,
				classes: "text-success",
			};
		case "pending":
			return {
				tooltip: `Pending on ${pendingCount} agent${pendingCount !== 1 ? "s" : ""}`,
				classes: "text-yellow-500",
			};
		default:
			return {
				tooltip: "Not yet synced",
				classes: "text-muted-foreground",
			};
	}
});
</script>

<button
	type="button"
	class="flex w-full cursor-pointer flex-col gap-1 rounded-lg px-2 py-1.5 text-left hover:bg-accent/40 {isSelected
		? 'bg-accent/60'
		: ''}"
	onclick={() => onSelect(skill.skill.id)}
>
	<!-- Top row: Skill name -->
	<div>
		<p class="line-clamp-2 text-[12px] leading-tight text-foreground">{skill.skill.name}</p>
	</div>

	<!-- Description -->
	{#if truncatedDesc}
		<div class="line-clamp-2 text-[11px] leading-tight text-muted-foreground/70">{truncatedDesc}</div>
	{/if}

	<!-- Metadata row: sync info (left) and sync status icon (right) -->
	<div class="flex items-center justify-between text-muted-foreground">
		<!-- Sync time and pending count on left -->
		<span class="shrink-0 flex-1 text-[11px]">
			{#if pendingCount > 0}
				<span>Pending on {pendingCount}</span>
				<span class="mx-1">|</span>
			{/if}
			<span>{lastSyncTime}</span>
		</span>

		<!-- Sync status icon on right with tooltip -->
		<div class="shrink-0" role="presentation">
			<Tooltip.Root>
				<Tooltip.Trigger
					class="rounded p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer"
					title={syncStatusInfo.tooltip}
				>
					{#if syncStatus === "syncing"}
						<Spinner class="shrink-0 {syncStatusInfo.classes}" size={12} />
					{:else if syncStatus === "synced"}
						<RoundedIcon name="check-circle" class="h-3 w-3 {syncStatusInfo.classes}" />
					{:else if syncStatus === "pending"}
						<RoundedIcon name="warning" class="h-3 w-3 {syncStatusInfo.classes}" />
					{:else}
						<RoundedIcon name="refresh" class="h-3 w-3 {syncStatusInfo.classes}" />
					{/if}
				</Tooltip.Trigger>
				<Tooltip.Content side="right" class="text-xs">
					{syncStatusInfo.tooltip}
				</Tooltip.Content>
			</Tooltip.Root>
		</div>
	</div>
</button>
