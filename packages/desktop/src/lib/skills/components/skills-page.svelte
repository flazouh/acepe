<script lang="ts">
import { okAsync } from "neverthrow";
import Copy from "phosphor-svelte/lib/Copy";
import FileText from "phosphor-svelte/lib/FileText";
import PuzzlePiece from "phosphor-svelte/lib/PuzzlePiece";
import Trash from "phosphor-svelte/lib/Trash";
import { onMount } from "svelte";
import {
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import { CodeMirrorEditor } from "$lib/components/ui/codemirror-editor/index.js";
import { Label } from "$lib/components/ui/label/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import { libraryApi } from "../api/skills-api.js";
import { createLibraryStore } from "../store/library-store.svelte.js";
import CreateSkillDialog from "./create-skill-dialog.svelte";
import PluginSkillsSection from "./plugin-skills-section.svelte";
import SkillListItem from "./skill-list-item.svelte";
import SyncDropdownButton from "./sync-dropdown-button.svelte";

// Create store at page level (provides context for children)
const store = createLibraryStore();

// Dialog state
let createDialogOpen = $state(false);
let deleteDialogOpen = $state(false);
let deleteFromAgents = $state(false);
let isDeleting = $state(false);

// Get synced agents for the selected skill
const syncedAgents = $derived(
	store.selectedSkill?.syncTargets.filter((t) => t.status === "synced") ?? []
);

onMount(() => {
	store.initialize().andThen(() => {
		const firstSkill = store.skills[0];
		if (!firstSkill) return okAsync(undefined);
		return store.selectSkill(firstSkill.skill.id);
	});
});

function handleEditorChange(value: string) {
	store.setEditorContent(value);
}

function handleSkillSelect(skillId: string) {
	// Clear plugin selection when selecting a library skill
	store.clearPluginSelection();
	store.selectSkill(skillId);
}

function handlePluginSkillSelect(skillId: string) {
	store.selectPluginSkill(skillId);
}

function handleCopyToLibrary() {
	if (!store.selectedPluginSkill) return;
	store.copyPluginSkillToLibrary(store.selectedPluginSkill.id);
}

// Whether we're viewing a plugin skill (read-only)
const isViewingPluginSkill = $derived(store.selectedPluginSkill !== null);

export function openCreateDialog() {
	createDialogOpen = true;
}

function openDeleteDialog() {
	deleteFromAgents = false;
	deleteDialogOpen = true;
}

async function handleDeleteSkill() {
	if (!store.selectedSkill) return;

	isDeleting = true;
	const skillName = store.selectedSkill.skill.name;
	const skillId = store.selectedSkill.skill.id;

	if (deleteFromAgents && syncedAgents.length > 0) {
		const agentIds = syncedAgents.map((a) => a.agentId);
		await libraryApi.deleteSkillFromAgents(skillName, agentIds);
	}

	await store.deleteSkill(skillId);

	isDeleting = false;
	deleteDialogOpen = false;
}

// Determine the overall sync status for a skill
function getSyncStatusForSkill(
	skillWithSync: (typeof store.skills)[number]
): "synced" | "pending" | "syncing" | "never" {
	if (store.syncing && store.selectedSkill?.skill.id === skillWithSync.skill.id) {
		return "syncing";
	}

	// Check if any enabled agents have pending/never status
	const hasPending = skillWithSync.syncTargets.some(
		(t) => t.enabled && (t.status === "pending" || t.status === "never")
	);
	if (hasPending) {
		return "pending";
	}

	// Check if any enabled agents are synced
	const hasSynced = skillWithSync.syncTargets.some((t) => t.enabled && t.status === "synced");
	if (hasSynced) {
		return "synced";
	}

	// If no enabled agents, return "never"
	return "never";
}
</script>

<div class="flex h-full w-full min-h-0">
	<!-- Left Panel: Skills List -->
	<div class="flex w-[220px] shrink-0 flex-col border-r border-border/50 min-h-0">
		<EmbeddedPanelHeader>
			<HeaderTitleCell>
				<span class="truncate text-[11px] font-medium text-foreground">Library</span>
			</HeaderTitleCell>
		</EmbeddedPanelHeader>
		<!-- Skills list -->
		<div class="flex-1 overflow-y-auto p-1.5 min-h-0">
			{#if store.loading && store.skills.length === 0}
				<div class="p-2 text-[12px] text-muted-foreground">Loading skills...</div>
			{:else if store.skills.length === 0}
				<div class="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
					<FileText class="h-8 w-8 text-muted-foreground opacity-50" />
					<p class="text-[12px] text-muted-foreground">No skills yet</p>
					<Button variant="outline" size="sm" onclick={openCreateDialog}>Create First Skill</Button>
				</div>
			{:else}
				<!-- Plugin Skills Section -->
				<PluginSkillsSection
					plugins={store.plugins}
					pluginSkills={store.pluginSkills}
					selectedPluginSkillId={store.selectedPluginSkill?.id ?? null}
					onSelectPluginSkill={handlePluginSkillSelect}
				/>

				<!-- Library Skills -->
				<div class="flex flex-col gap-0.5">
					{#each store.skills as skillWithSync (skillWithSync.skill.id)}
						{@const isSelected =
							store.selectedSkillId === skillWithSync.skill.id && !isViewingPluginSkill}
						{@const pendingCount = store.getSkillPendingCount(skillWithSync)}
						{@const lastSyncTime = store.getSkillLastSyncTime(skillWithSync)}
						{@const syncStatus = getSyncStatusForSkill(skillWithSync)}
						<SkillListItem
							skill={skillWithSync}
							{isSelected}
							onSelect={handleSkillSelect}
							{pendingCount}
							{lastSyncTime}
							{syncStatus}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Right Panel: Editor -->
	<div class="flex-1 flex flex-col min-w-0 min-h-0">
		<EmbeddedPanelHeader>
			<HeaderTitleCell>
				{#if isViewingPluginSkill && store.selectedPluginSkill}
					<PuzzlePiece class="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" weight="fill" />
					<span class="truncate text-[11px] font-medium text-foreground">
						{store.selectedPluginSkill.name}
					</span>
					<span class="ml-1 text-[11px] text-muted-foreground/60">(read-only)</span>
				{:else if store.selectedSkill}
					<span class="truncate text-[11px] font-medium text-foreground">
						{store.selectedSkill.skill.name}
					</span>
					{#if store.isSaving}
						<Spinner class="ml-1 h-3 w-3 text-muted-foreground" />
					{/if}
				{:else}
					<span class="text-[11px] text-muted-foreground">No skill selected</span>
				{/if}
			</HeaderTitleCell>
			<HeaderActionCell>
			{#if isViewingPluginSkill && store.selectedPluginSkill}
				<Button variant="outline" size="sm" class="h-7 text-[11px]" onclick={handleCopyToLibrary}>
					<Copy class="mr-1.5 h-3.5 w-3.5" weight="bold" />
					Copy to Library
				</Button>
			{:else if store.selectedSkill}
				<Button
					variant="ghost"
					size="icon-sm"
					class="h-7 w-7"
					onclick={openDeleteDialog}
					title="Delete Skill"
				>
					<Trash class="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" weight="fill" />
				</Button>
				<SyncDropdownButton />
			{/if}
			</HeaderActionCell>
		</EmbeddedPanelHeader>

		{#if isViewingPluginSkill && store.selectedPluginSkill}
			<div class="flex-1 overflow-hidden min-h-0 bg-background">
				<CodeMirrorEditor
					value={store.editorContent}
					language="markdown"
					onChange={handleEditorChange}
					readonly={true}
				/>
			</div>
		{:else if store.selectedSkill}
			<div class="flex-1 overflow-hidden min-h-0 bg-background">
				{#key store.selectedSkillId}
					<CodeMirrorEditor
						value={store.editorContent}
						language="markdown"
						onChange={handleEditorChange}
					/>
				{/key}
			</div>
		{:else}
			<div
				class="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground min-h-0 bg-background"
			>
				<FileText class="h-12 w-12 opacity-50" />
				<p class="text-[12px]">Select a skill to view or edit</p>
			</div>
		{/if}
	</div>
</div>

<!-- Create Skill Dialog -->
<CreateSkillDialog bind:open={createDialogOpen} onOpenChange={(v) => (createDialogOpen = v)} />

<!-- Delete Confirmation Dialog -->
<AlertDialog.Root bind:open={deleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Skill</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure you want to delete "{store.selectedSkill?.skill.name}"? This action cannot be
				undone.
			</AlertDialog.Description>
		</AlertDialog.Header>

		{#if syncedAgents.length > 0}
			<div class="py-4">
				<div class="flex items-center justify-between">
					<Label for="delete-from-agents" class="text-sm font-medium">
						Also delete from agent folders
					</Label>
					<Switch
						id="delete-from-agents"
						checked={deleteFromAgents}
						onchange={(e) => (deleteFromAgents = (e.target as HTMLInputElement).checked)}
					/>
				</div>
				<p class="text-xs text-muted-foreground mt-1.5">
					Remove the skill files from these synced agents:
				</p>
				<div class="space-y-2 mt-2">
					{#each syncedAgents as agent (agent.agentId)}
						<div class="flex items-center justify-between px-2 py-1.5 bg-muted rounded-sm">
							<div class="flex items-center gap-2">
								<AgentIcon agentId={agent.agentId} size={16} class="h-4 w-4" />
								<span class="text-sm">{agent.agentName}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={isDeleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={handleDeleteSkill} disabled={isDeleting}>
				{isDeleting ? "Deleting..." : "Delete"}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Error display -->
{#if store.error}
	<div
		class="absolute bottom-4 right-4 bg-destructive text-destructive-foreground px-4 py-2 rounded shadow-lg"
	>
		<button type="button" class="absolute top-1 right-1 p-1" onclick={() => store.clearError()}>
			×
		</button>
		{store.error}
	</div>
{/if}
