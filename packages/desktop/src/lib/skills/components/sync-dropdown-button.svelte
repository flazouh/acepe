<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import { ChevronDown, FolderOpen } from "@lucide/svelte/icons";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import ArrowsClockwise from "phosphor-svelte/lib/ArrowsClockwise";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import { default as PhosphorWarning } from "phosphor-svelte/lib/Warning";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import { libraryApi } from "../api/skills-api.js";
import { getLibraryStore } from "../store/library-store.svelte.js";

const store = getLibraryStore();

function handleSync() {
	if (store.selectedSkill) {
		store.syncSkill(store.selectedSkill.skill.id);
	}
}

function handleToggleAgent(e: Event, agentId: string, enabled: boolean) {
	e.preventDefault();
	e.stopPropagation();
	if (store.selectedSkill) {
		store.setSyncTarget(store.selectedSkill.skill.id, agentId, enabled);
	}
}

function handleOpenFolder(e: Event, agentId: string) {
	e.preventDefault();
	e.stopPropagation();
	if (store.selectedSkill) {
		libraryApi.getSkillFolderPath(agentId, store.selectedSkill.skill.name).map((path) => {
			if (path) {
				revealItemInDir(path);
			}
			return path;
		});
	}
}

const enabledCount = $derived(store.availableAgents.filter((a) => a.enabled).length);
const pendingCount = $derived(
	store.availableAgents.filter((a) => a.enabled && (a.status === "pending" || a.status === "never"))
		.length
);

const syncStatus = $derived.by(() => {
	if (store.syncing) return "syncing";
	if (!store.selectedSkill) return "idle";

	const enabledAgents = store.availableAgents.filter((a) => a.enabled);
	if (enabledAgents.length === 0) return "idle";

	const hasPending = enabledAgents.some((a) => a.status === "pending" || a.status === "never");
	if (hasPending) return "pending";

	return "synced";
});
</script>

<div class="flex items-center gap-1">
	<button
		type="button"
		class="flex h-7 shrink-0 items-center gap-1.5 border border-border/50 bg-accent/5 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
		onclick={handleSync}
		disabled={store.syncing || !store.selectedSkill || enabledCount === 0}
	>
		{#if syncStatus === "syncing"}
			<Spinner class="mr-1 h-3.5 w-3.5" />
			Syncing
		{:else if syncStatus === "synced"}
			<CheckCircle class="mr-1 h-3.5 w-3.5 text-success" weight="fill" />
			Synced
		{:else if syncStatus === "pending"}
			<PhosphorWarning class="mr-1 h-3.5 w-3.5 text-yellow-500" weight="fill" />
			Sync {pendingCount}
		{:else}
			<ArrowsClockwise class="mr-1 h-3.5 w-3.5 text-muted-foreground" weight="fill" />
			Sync {enabledCount}
		{/if}
	</button>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger disabled={!store.selectedSkill || store.syncing}>
			{#snippet child({ props })}
				<EmbeddedIconButton
					title="Sync settings"
					ariaLabel="Sync settings"
					class="border border-border/50 bg-accent/5"
					disabled={!store.selectedSkill || store.syncing}
					{...props}
				>
					<ChevronDown class="h-3.5 w-3.5" />
				</EmbeddedIconButton>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-56">
			<DropdownMenu.Label>Sync to agents</DropdownMenu.Label>
			<DropdownMenu.Separator />
			{#each store.availableAgents as agent (agent.id)}
				<div
					class="relative flex cursor-pointer select-none items-center justify-between rounded-sm px-2 py-1.5 text-[12px] outline-none hover:bg-accent hover:text-accent-foreground"
					onclick={(e) => handleToggleAgent(e, agent.id, !agent.enabled)}
					onkeydown={(e) => e.key === "Enter" && handleToggleAgent(e, agent.id, !agent.enabled)}
					role="menuitemcheckbox"
					aria-checked={agent.enabled}
					tabindex="0"
				>
					<div class="flex items-center gap-2">
						<AgentIcon agentId={agent.id} size={16} class="h-4 w-4" />
						<span>{agent.name}</span>
						{#if agent.enabled && (agent.status === "pending" || agent.status === "never")}
							<PhosphorWarning class="h-3 w-3 text-yellow-500" weight="fill" />
						{/if}
					</div>
					<div class="flex items-center gap-2">
						{#if agent.status === "synced"}
							<button
								type="button"
								class="rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
								onclick={(e) => handleOpenFolder(e, agent.id)}
								title="Open in folder"
							>
								<FolderOpen class="h-3.5 w-3.5" />
							</button>
						{/if}
						<Switch checked={agent.enabled} class="cursor-pointer" />
					</div>
				</div>
			{/each}
			{#if store.availableAgents.length === 0}
				<DropdownMenu.Item disabled>No agents available</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
