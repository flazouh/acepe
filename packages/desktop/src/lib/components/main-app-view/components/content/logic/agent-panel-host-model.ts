import type { SessionIdentity } from "$lib/acp/application/dto/session-identity.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { Panel, PanelHotState } from "$lib/acp/store/types.js";

export interface AgentPanelHostAgent {
	readonly id: string;
}

export interface AgentPanelHostModelInput {
	readonly panel: Panel;
	readonly sessionIdentity: SessionIdentity | undefined;
	readonly projects: readonly Project[];
	readonly availableAgents: readonly AgentPanelHostAgent[];
	readonly hotState: PanelHotState | null;
}

export interface AgentPanelHostModel {
	readonly projectPath: string | null;
	readonly project: Project | null;
	readonly selectedAgentId: string | null;
	readonly isWaitingForSession: boolean;
	readonly reviewMode: boolean;
	readonly reviewFilesState: PanelHotState["reviewFilesState"];
	readonly reviewFileIndex: number;
}

export function buildAgentPanelHostModel(input: AgentPanelHostModelInput): AgentPanelHostModel {
	const projectPath = resolveAgentPanelHostProjectPath(input.panel, input.sessionIdentity);
	return {
		projectPath,
		project: projectPath === null ? null : findProjectByPath(input.projects, projectPath),
		selectedAgentId: resolveAgentPanelHostSelectedAgentId({
			panel: input.panel,
			sessionIdentity: input.sessionIdentity,
			availableAgents: input.availableAgents,
		}),
		isWaitingForSession: input.panel.sessionId !== null && input.sessionIdentity === undefined,
		reviewMode: input.hotState?.reviewMode ?? false,
		reviewFilesState: input.hotState?.reviewFilesState ?? null,
		reviewFileIndex: input.hotState?.reviewFileIndex ?? 0,
	};
}

export function resolveAgentPanelHostProjectPath(
	panel: Panel,
	sessionIdentity: SessionIdentity | undefined
): string | null {
	if (panel.sessionId !== null) {
		return sessionIdentity?.projectPath ?? panel.projectPath ?? null;
	}

	return panel.projectPath ?? null;
}

export function resolveAgentPanelHostSelectedAgentId(input: {
	readonly panel: Panel;
	readonly sessionIdentity: SessionIdentity | undefined;
	readonly availableAgents: readonly AgentPanelHostAgent[];
}): string | null {
	const configuredAgentId =
		input.panel.sessionId !== null
			? (input.sessionIdentity?.agentId ??
				input.panel.agentId ??
				input.panel.selectedAgentId ??
				null)
			: (input.panel.selectedAgentId ?? null);

	if (configuredAgentId === null) {
		if (input.panel.sessionId === null) {
			return input.availableAgents[0]?.id ?? null;
		}
		return null;
	}

	return input.availableAgents.some((agent) => agent.id === configuredAgentId)
		? configuredAgentId
		: null;
}

function findProjectByPath(
	projects: readonly Project[],
	projectPath: string
): Project | null {
	return projects.find((candidate) => candidate.path === projectPath) ?? null;
}
