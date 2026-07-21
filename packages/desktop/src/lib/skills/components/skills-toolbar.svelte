<script lang="ts">
import { HugeiconsIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";

import { getSkillsStore } from "../store/skills-store.svelte.js";

interface Props {
	onCreateSkill?: () => void;
}

let { onCreateSkill }: Props = $props();

const store = getSkillsStore();

// Get other agents for "Copy to" menu
const otherAgents = $derived(
	store.agents.filter((agent) => agent.agentId !== store.selectedSkill?.agentId)
);

function handleSave() {
	store.saveSkill();
}

function handleCopyTo(agentId: string) {
	if (store.selectedSkill) {
		store.copySkillTo(store.selectedSkill.id, agentId);
	}
}

function handleDelete() {
	if (store.selectedSkill && confirm(`Delete skill "${store.selectedSkill.name}"?`)) {
		store.deleteSkill(store.selectedSkill.id);
	}
}
</script>

<div class="flex items-center justify-between px-3 py-2 border-b">
	<div class="flex items-center gap-2">
		{#if store.selectedSkill}
			<span class="text-sm font-medium">{store.selectedSkill.name}</span>
			{#if store.isDirty}
				<span class="text-xs text-muted-foreground">(unsaved)</span>
			{/if}
		{:else}
			<span class="text-sm text-muted-foreground">No skill selected</span>
		{/if}
	</div>

	<div class="flex items-center gap-1">
		{#if onCreateSkill}
			<Button variant="ghost" size="sm" onclick={onCreateSkill}>
				<HugeiconsIcon name="plus" size={14} class="mr-1" />
				New
			</Button>
		{/if}

		{#if store.selectedSkill}
			<Button
				variant="ghost"
				size="sm"
				onclick={handleSave}
				disabled={!store.isDirty || store.isSaving}
			>
				{#if store.isSaving}
					<Spinner class="mr-1" size={16} />
				{:else}
					<HugeiconsIcon name="save" size={16} class="h-4 w-4 mr-1" />
				{/if}
				Save
			</Button>

			<Selector align="end" triggerSize="icon" showChevron={false} variant="ghost">
				{#snippet renderButton()}
					<HugeiconsIcon name="more" />
				{/snippet}

				{#if otherAgents.length > 0}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger>
							<HugeiconsIcon
								name="copy"
								class="h-4 w-4 mr-2"
								data-testid="skills-toolbar-copy-hugeicons-icon"
							/>
							Copy to
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent>
							{#each otherAgents as agent (agent.id)}
								<DropdownMenu.Item onclick={() => handleCopyTo(agent.agentId)}>
									{agent.label}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
					<DropdownMenu.Separator />
				{/if}
				<DropdownMenu.Item onclick={handleDelete} class="text-destructive">
					<HugeiconsIcon name="trash" class="h-4 w-4 mr-2" />
					Delete
				</DropdownMenu.Item>
			</Selector>
		{/if}
	</div>
</div>
