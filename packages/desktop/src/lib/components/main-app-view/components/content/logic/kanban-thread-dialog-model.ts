import type { SessionIdentity } from "$lib/acp/application/dto/session-identity.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { Panel, PanelHotState } from "$lib/acp/store/types.js";

export interface KanbanThreadDialogAgent {
	readonly id: string;
}

export interface KanbanThreadDialogPanelSnapshotInput {
	readonly panel: Panel | null;
	readonly sessionIdentity: SessionIdentity | undefined;
	readonly hotState: PanelHotState | null;
	readonly getProject: (projectPath: string) => Project | undefined;
}

export interface KanbanThreadDialogPanelSnapshot {
	readonly panelId: string;
	readonly sessionId: string | null;
	readonly width: number;
	readonly pendingProjectSelection: boolean;
	readonly selectedAgentId: string | null;
	readonly isWaitingForSession: boolean;
	readonly project: Project | null;
}

export function buildKanbanThreadDialogPanelSnapshot(
	input: KanbanThreadDialogPanelSnapshotInput
): KanbanThreadDialogPanelSnapshot {
	const panel = input.panel;
	if (panel === null) {
		return EMPTY_KANBAN_THREAD_DIALOG_PANEL_SNAPSHOT;
	}

	const sessionProjectPath = resolveKanbanThreadDialogProjectPath(panel, input.sessionIdentity);
	return {
		panelId: panel.id,
		sessionId: panel.sessionId,
		width: panel.width > 0 ? panel.width : 100,
		pendingProjectSelection: panel.pendingProjectSelection,
		selectedAgentId: resolveKanbanThreadDialogConfiguredAgentId(panel, input.sessionIdentity),
		isWaitingForSession: panel.sessionId !== null && input.sessionIdentity === undefined,
		project:
			sessionProjectPath === null
				? null
				: (input.getProject(sessionProjectPath) ?? null),
	};
}

export function resolveKanbanThreadDialogSelectedAgentId(input: {
	readonly configuredAgentId: string | null;
	readonly availableAgents: readonly KanbanThreadDialogAgent[];
}): string | null {
	if (input.configuredAgentId === null) {
		return null;
	}

	return input.availableAgents.some((agent) => agent.id === input.configuredAgentId)
		? input.configuredAgentId
		: null;
}

function resolveKanbanThreadDialogProjectPath(
	panel: Panel,
	sessionIdentity: SessionIdentity | undefined
): string | null {
	if (panel.sessionId !== null) {
		return sessionIdentity?.projectPath ?? null;
	}

	return panel.projectPath ?? null;
}

function resolveKanbanThreadDialogConfiguredAgentId(
	panel: Panel,
	sessionIdentity: SessionIdentity | undefined
): string | null {
	if (panel.sessionId !== null) {
		return sessionIdentity?.agentId ?? null;
	}

	return panel.selectedAgentId ?? null;
}

const EMPTY_KANBAN_THREAD_DIALOG_PANEL_SNAPSHOT: KanbanThreadDialogPanelSnapshot = {
	panelId: "",
	sessionId: null,
	width: 100,
	pendingProjectSelection: false,
	selectedAgentId: null,
	isWaitingForSession: false,
	project: null,
};
