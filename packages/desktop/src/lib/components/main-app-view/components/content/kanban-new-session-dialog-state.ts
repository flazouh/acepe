import type { AgentInfo } from "$lib/acp/logic/agent-manager.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";

import { resolveEmptyStateWorktreePending } from "./logic/empty-state-send-state.js";

interface ResolveKanbanNewSessionDefaultsInput {
	readonly projects: readonly Project[];
	readonly focusedProjectPath: string | null;
	readonly availableAgents: readonly AgentInfo[];
	readonly selectedAgentIds: readonly string[];
	readonly defaultAgentId?: string | null;
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
	readonly modeId?: CanonicalModeId;
}

export interface KanbanNewSessionResetState {
	readonly selectedProjectPath: string | null;
	readonly selectedAgentId: string | null;
	readonly initialModeId: string | null;
	readonly composerKey: number;
	readonly activeWorktreePath: string | null;
	readonly preparedWorktreeLaunch: null;
	readonly worktreePending: boolean;
}

export interface BuildKanbanNewSessionResetStateInput
	extends ResolveKanbanNewSessionDefaultsInput {
	readonly request?: KanbanNewSessionRequest | null;
	readonly currentComposerKey: number;
	readonly fallbackModeId: CanonicalModeId;
	readonly isProjectWorktreeEnabled: (projectPath: string) => boolean;
}

export interface BuildKanbanNewSessionProjectChangeStateInput {
	readonly projectPath: string;
	readonly isProjectWorktreeEnabled: (projectPath: string) => boolean;
}

export interface KanbanNewSessionProjectChangeState {
	readonly selectedProjectPath: string;
	readonly activeWorktreePath: string | null;
	readonly preparedWorktreeLaunch: null;
	readonly worktreePending: boolean;
}

export type KanbanNewSessionOpenChangeAction =
	| { readonly kind: "ignore" }
	| { readonly kind: "close" }
	| { readonly kind: "open"; readonly request: KanbanNewSessionRequest | null };

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
	// 1. Explicit request wins
	if (input.requestedAgentId) {
		for (const agent of input.availableAgents) {
			if (agent.id === input.requestedAgentId) {
				return agent.id;
			}
		}
	}

	// 2. User's persisted default agent preference
	if (input.defaultAgentId) {
		for (const agent of input.availableAgents) {
			if (agent.id === input.defaultAgentId) {
				return agent.id;
			}
		}
	}

	// 3. First selected agent
	for (const selectedAgentId of input.selectedAgentIds) {
		for (const agent of input.availableAgents) {
			if (agent.id === selectedAgentId) {
				return agent.id;
			}
		}
	}

	// 4. First available agent
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

export function buildKanbanNewSessionResetState(
	input: BuildKanbanNewSessionResetStateInput
): KanbanNewSessionResetState {
	const request = input.request ?? null;
	const defaults = resolveKanbanNewSessionDefaults({
		projects: input.projects,
		focusedProjectPath: input.focusedProjectPath,
		availableAgents: input.availableAgents,
		selectedAgentIds: input.selectedAgentIds,
		defaultAgentId: input.defaultAgentId,
		requestedProjectPath: request?.projectPath ?? null,
		requestedAgentId: request?.agentId ?? null,
	});

	return {
		selectedProjectPath: defaults.projectPath,
		selectedAgentId: defaults.agentId,
		initialModeId: request?.modeId ?? input.fallbackModeId,
		composerKey: input.currentComposerKey + 1,
		activeWorktreePath: null,
		preparedWorktreeLaunch: null,
		worktreePending: defaults.projectPath
			? resolveEmptyStateWorktreePending({
					activeWorktreePath: null,
					projectPath: defaults.projectPath,
					isProjectWorktreeEnabled: input.isProjectWorktreeEnabled,
				})
			: false,
	};
}

export function buildKanbanNewSessionProjectChangeState(
	input: BuildKanbanNewSessionProjectChangeStateInput
): KanbanNewSessionProjectChangeState {
	return {
		selectedProjectPath: input.projectPath,
		activeWorktreePath: null,
		preparedWorktreeLaunch: null,
		worktreePending: resolveEmptyStateWorktreePending({
			activeWorktreePath: null,
			projectPath: input.projectPath,
			isProjectWorktreeEnabled: input.isProjectWorktreeEnabled,
		}),
	};
}

export function resolveKanbanNewSessionOpenChangeAction(input: {
	readonly nextOpen: boolean;
	readonly currentOpen: boolean;
	readonly pendingRequest: KanbanNewSessionRequest | null;
}): KanbanNewSessionOpenChangeAction {
	if (input.nextOpen === input.currentOpen && input.pendingRequest === null) {
		return { kind: "ignore" };
	}

	if (!input.nextOpen) {
		return { kind: "close" };
	}

	return {
		kind: "open",
		request: input.pendingRequest,
	};
}
