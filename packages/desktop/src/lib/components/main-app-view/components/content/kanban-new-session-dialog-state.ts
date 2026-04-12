import type { AgentInfo } from "$lib/acp/logic/agent-manager.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";

interface ResolveKanbanNewSessionDefaultsInput {
	readonly projects: readonly Project[];
	readonly focusedProjectPath: string | null;
	readonly availableAgents: readonly AgentInfo[];
	readonly selectedAgentIds: readonly string[];
	readonly requestedProjectPath?: string | null;
	readonly requestedAgentId?: string | null;
}

interface KanbanNewSessionDefaults {
	readonly projectPath: string | null;
	readonly agentId: string | null;
}

export interface KanbanNewSessionRequest {
	readonly projectPath?: string;
	readonly agentId?: string;
}

function resolveDefaultProjectPath(input: ResolveKanbanNewSessionDefaultsInput): string | null {
	if (input.requestedProjectPath) {
		for (const project of input.projects) {
			if (project.path === input.requestedProjectPath) {
				return project.path;
			}
		}
	}

	if (input.focusedProjectPath) {
		for (const project of input.projects) {
			if (project.path === input.focusedProjectPath) {
				return project.path;
			}
		}
	}

	const firstProject = input.projects[0];
	return firstProject ? firstProject.path : null;
}

function resolveDefaultAgentId(input: ResolveKanbanNewSessionDefaultsInput): string | null {
	if (input.requestedAgentId) {
		for (const agent of input.availableAgents) {
			if (agent.id === input.requestedAgentId) {
				return agent.id;
			}
		}
	}

	for (const selectedAgentId of input.selectedAgentIds) {
		for (const agent of input.availableAgents) {
			if (agent.id === selectedAgentId) {
				return agent.id;
			}
		}
	}

	const firstAgent = input.availableAgents[0];
	return firstAgent ? firstAgent.id : null;
}

export function resolveKanbanNewSessionDefaults(
	input: ResolveKanbanNewSessionDefaultsInput
): KanbanNewSessionDefaults {
	return {
		projectPath: resolveDefaultProjectPath(input),
		agentId: resolveDefaultAgentId(input),
	};
}
