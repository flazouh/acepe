<script lang="ts">
	import IconPlus from "@tabler/icons-svelte/icons/plus";
	import { ProjectLetterBadge } from "@acepe/ui";
	import AgentInput from "$lib/acp/components/agent-input/agent-input-ui.svelte";
	import type { AgentInfo } from "$lib/acp/logic/agent-manager.js";
	import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
	import {
		getAgentPreferencesStore,
		getAgentStore,
		getPanelStore,
	} from "$lib/acp/store/index.js";
	import { createLogger } from "$lib/acp/utils/logger.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import {
		ensureSpawnableAgentSelected,
		getSpawnableSessionAgents,
	} from "../../logic/spawnable-agents.js";
	import { resolveKanbanNewSessionDefaults } from "./kanban-new-session-dialog-state.js";

	interface Props {
		projectManager: ProjectManager;
	}

	let { projectManager }: Props = $props();

	const panelStore = getPanelStore();
	const agentStore = getAgentStore();
	const agentPreferencesStore = getAgentPreferencesStore();
	const logger = createLogger({
		id: "kanban-new-session-dialog",
		name: "KanbanNewSessionDialog",
	});

	let open = $state(false);
	let selectedProjectPath = $state<string | null>(null);
	let selectedAgentId = $state<string | null>(null);

	const availableAgents = $derived.by((): AgentInfo[] => {
		const spawnableAgents = getSpawnableSessionAgents(
			agentStore.agents,
			agentPreferencesStore.selectedAgentIds
		);

		return spawnableAgents.map((agent) => ({
			id: agent.id,
			name: agent.name,
			icon: agent.icon,
			availability_kind: agent.availability_kind,
		}));
	});

	const selectedProject = $derived.by((): Project | null => {
		if (!selectedProjectPath) {
			return null;
		}

		for (const project of projectManager.projects) {
			if (project.path === selectedProjectPath) {
				return project;
			}
		}

		return null;
	});

	const selectedAgent = $derived.by((): AgentInfo | null => {
		if (!selectedAgentId) {
			return null;
		}

		for (const agent of availableAgents) {
			if (agent.id === selectedAgentId) {
				return agent;
			}
		}

		return null;
	});

	const canCompose = $derived(selectedProject !== null && selectedAgent !== null);
	const createDisabled = $derived(
		projectManager.projects.length === 0 || availableAgents.length === 0
	);

	function resetSelections(): void {
		const defaults = resolveKanbanNewSessionDefaults({
			projects: projectManager.projects,
			focusedProjectPath: panelStore.focusedViewProjectPath,
			availableAgents,
			selectedAgentIds: agentPreferencesStore.selectedAgentIds,
		});

		selectedProjectPath = defaults.projectPath;
		selectedAgentId = defaults.agentId;
	}

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		if (nextOpen) {
			resetSelections();
		}
	}

	function handleProjectChange(value: string): void {
		selectedProjectPath = value.length > 0 ? value : null;
	}

	function handleAgentChange(value: string): void {
		selectedAgentId = value.length > 0 ? value : null;
		if (!selectedAgentId) {
			return;
		}

		if (agentPreferencesStore.selectedAgentIds.includes(selectedAgentId)) {
			return;
		}

		const nextSelectedAgentIds = ensureSpawnableAgentSelected(
			agentPreferencesStore.selectedAgentIds,
			selectedAgentId
		);

		void agentPreferencesStore.setSelectedAgentIds(nextSelectedAgentIds).match(
			() => undefined,
			(error) => {
				logger.error("Failed to persist selected agent for kanban dialog", {
					agentId: selectedAgentId,
					error,
				});
			}
		);
	}

	function handleSessionCreated(sessionId: string): void {
		const panel = panelStore.openSession(sessionId, 450);
		open = false;

		if (!panel) {
			return;
		}

		panelStore.setViewMode("single");
		panelStore.focusAndSwitchToPanel(panel.id);
	}
</script>

<Button
	variant="outline"
	size="sm"
	class="h-8 gap-2 rounded-lg"
	onclick={() => handleOpenChange(true)}
	disabled={createDisabled}
>
	<IconPlus class="h-3.5 w-3.5" />
	<span>New session</span>
</Button>

<Dialog.Root bind:open={open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-4xl rounded-2xl p-0" portalProps={{ disabled: true }}>
		<Dialog.Header class="border-b border-border/50 px-5 py-4">
			<Dialog.Title>New session</Dialog.Title>
			<Dialog.Description>
				Choose a project and agent, then send the first message.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-4 px-5 py-4">
			<div class="grid gap-3 md:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Project
					</span>
					<Select
						value={selectedProjectPath ? selectedProjectPath : ""}
						onValueChange={handleProjectChange}
						type="single"
					>
						<SelectTrigger class="w-full justify-between">
							{#if selectedProject}
								<div class="flex min-w-0 items-center gap-2">
									<ProjectLetterBadge
										name={selectedProject.name}
										color={selectedProject.color}
										size={16}
									/>
									<span class="truncate">{selectedProject.name}</span>
								</div>
							{:else}
								<span>Select project</span>
							{/if}
						</SelectTrigger>
						<SelectContent>
							{#each projectManager.projects as project (project.path)}
								<SelectItem value={project.path} label={project.name}>
									<div class="flex min-w-0 items-center gap-2">
										<ProjectLetterBadge
											name={project.name}
											color={project.color}
											size={16}
										/>
										<span class="truncate">{project.name}</span>
									</div>
								</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>

				<div class="flex flex-col gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Agent
					</span>
					<Select
						value={selectedAgentId ? selectedAgentId : ""}
						onValueChange={handleAgentChange}
						type="single"
					>
						<SelectTrigger class="w-full justify-between">
							{#if selectedAgent}
								<div class="flex min-w-0 items-center gap-2">
									<img src={selectedAgent.icon} alt="" class="h-4 w-4 shrink-0 rounded-sm" />
									<span class="truncate">{selectedAgent.name}</span>
								</div>
							{:else}
								<span>Select agent</span>
							{/if}
						</SelectTrigger>
						<SelectContent>
							{#each availableAgents as agent (agent.id)}
								<SelectItem value={agent.id} label={agent.name}>
									<div class="flex min-w-0 items-center gap-2">
										<img src={agent.icon} alt="" class="h-4 w-4 shrink-0 rounded-sm" />
										<span class="truncate">{agent.name}</span>
									</div>
								</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
			</div>

			{#if canCompose}
				{#key `${selectedProjectPath ? selectedProjectPath : ""}:${selectedAgentId ? selectedAgentId : ""}`}
					<AgentInput
						projectPath={selectedProject.path}
						projectName={selectedProject.name}
						selectedAgentId={selectedAgent.id}
						availableAgents={availableAgents}
						onAgentChange={handleAgentChange}
						onSessionCreated={handleSessionCreated}
					/>
				{/key}
			{:else}
				<div class="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
					Select a project and an agent to start typing your first message.
				</div>
			{/if}
		</div>

		<Dialog.Footer class="border-t border-border/50 px-5 py-3">
			<Button variant="ghost" onclick={() => handleOpenChange(false)}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>