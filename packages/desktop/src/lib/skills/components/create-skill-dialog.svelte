<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { Input } from "$lib/components/ui/input/index.js";
import { Label } from "$lib/components/ui/label/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import { Textarea } from "$lib/components/ui/textarea/index.js";
import { Sparkle } from "phosphor-svelte";

import { getLibraryStore } from "../store/library-store.svelte.js";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

let { open = $bindable(), onOpenChange }: Props = $props();

const store = getLibraryStore();

let skillName = $state("");
let description = $state("");
let category = $state("");
let isCreating = $state(false);
let error = $state<string | null>(null);
let selectedAgents = $state(new SvelteSet<string>());

const agents = $derived(store.availableAgents);

$effect(() => {
	if (open) {
		skillName = "";
		description = "";
		category = "";
		error = null;
		selectedAgents = new SvelteSet();
	}
});

const isValid = $derived(skillName.trim().length > 0);

function toggleAgent(agentId: string) {
	const newSet = new SvelteSet(selectedAgents);
	if (newSet.has(agentId)) {
		newSet.delete(agentId);
	} else {
		newSet.add(agentId);
	}
	selectedAgents = newSet;
}

function toggleAllAgents() {
	if (selectedAgents.size === agents.length) {
		selectedAgents = new SvelteSet();
	} else {
		selectedAgents = new SvelteSet(agents.map((a) => a.id));
	}
}

async function handleCreate() {
	if (!isValid) return;

	isCreating = true;
	error = null;

	const content = `---
name: "${skillName.trim()}"
description: "${description.trim() || "A custom skill"}"
---

# ${skillName.trim()}

${description.trim() || "Add your skill instructions here."}
`;

	const result = await store.createSkill(
		skillName.trim(),
		description.trim() || null,
		content,
		category.trim() || null
	);

	result.match(
		async (skill) => {
			const agentPromises = Array.from(selectedAgents).map((agentId) =>
				store.setSyncTarget(skill.id, agentId, true)
			);
			await Promise.all(agentPromises);

			if (selectedAgents.size > 0) {
				await store.syncSkill(skill.id);
			}

			isCreating = false;
			onOpenChange(false);
			store.selectSkill(skill.id);
		},
		(err) => {
			isCreating = false;
			error = err.message;
		}
	);
}

function handleClose() {
	onOpenChange(false);
}
</script>

<DialogFrame
	{open}
	title="Create New Skill"
	closeLabel="Close create skill dialog"
	size="form"
	{onOpenChange}
>
	{#snippet topLeft()}
		<Sparkle size={14} weight="bold" class="shrink-0 text-primary" />
		<span class="truncate text-[11px] font-semibold text-foreground select-none">Create New Skill</span>
	{/snippet}

	<div class="grid gap-4 px-3 py-3">
		<p class="text-[12px] text-muted-foreground">
			Create a skill in your library and optionally sync it to agents.
		</p>

		<div class="grid gap-2">
			<Label for="name">Skill Name</Label>
			<Input id="name" bind:value={skillName} placeholder="e.g., Research Assistant" />
		</div>

		<div class="grid gap-2">
			<Label for="description">Description (optional)</Label>
			<Textarea
				id="description"
				bind:value={description}
				placeholder="What does this skill do?"
				rows={2}
			/>
		</div>

		<div class="grid gap-2">
			<Label for="category">Category (optional)</Label>
			<Input id="category" bind:value={category} placeholder="e.g., Development, Research" />
		</div>

		{#if agents.length > 0}
			<div class="grid gap-2">
				<div class="flex items-center justify-between">
					<Label>Sync to agents (optional)</Label>
					{#if agents.length > 1}
						<Button variant="header" size="header" onclick={toggleAllAgents}>
							{selectedAgents.size === agents.length ? "Deselect All" : "Select All"}
						</Button>
					{/if}
				</div>
				<div class="space-y-2">
					{#each agents as agent (agent.id)}
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<AgentIcon agentId={agent.id} size={16} class="h-4 w-4" />
								<span class="text-sm">{agent.name}</span>
							</div>
							<Switch
								checked={selectedAgents.has(agent.id)}
								onchange={() => toggleAgent(agent.id)}
							/>
						</div>
					{/each}
				</div>
				<p class="text-xs text-muted-foreground">
					Selected agents will receive the skill immediately after creation.
				</p>
			</div>
		{/if}

		{#if error}
			<p class="text-sm text-destructive">{error}</p>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="header" size="header" onclick={handleClose}>Cancel</Button>
		<Button variant="invert" size="header" disabled={!isValid || isCreating} onclick={handleCreate}>
			{isCreating ? "Creating..." : "Create Skill"}
		</Button>
	{/snippet}
</DialogFrame>
