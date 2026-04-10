/**
 * Panel Grouping Utility - Groups panels by project for ProjectCard rendering.
 */

import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { BrowserPanel } from "$lib/acp/store/browser-panel-type.js";
import type { FilePanel } from "$lib/acp/store/file-panel-type.js";
import type { GitPanel } from "$lib/acp/store/git-panel-type.js";
import type { ReviewPanel } from "$lib/acp/store/review-panel-type.js";
import type {
	BrowserWorkspacePanel,
	TerminalPanelGroup,
	WorkspacePanel,
} from "$lib/acp/store/types.js";

export interface UnifiedWorkspacePanelGroup<
	TAgent extends { id: string; projectPath: string | null },
> {
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
	readonly agentPanels: readonly TAgent[];
	readonly filePanels: readonly FilePanel[];
	readonly reviewPanels: readonly ReviewPanel[];
	readonly terminalPanels: readonly TerminalPanelGroup[];
	readonly browserPanels: readonly BrowserPanel[];
	readonly gitPanels: readonly GitPanel[];
}

/**
 * A group of agent panels belonging to the same project.
 */
export interface AgentPanelGroup<T extends { sessionProjectPath: string | null }> {
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
	readonly panels: readonly T[];
}

/**
 * A unified group containing all panel types for a single project.
 */
export interface ProjectPanelGroup<TAgent extends { sessionProjectPath: string | null }> {
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
	readonly agentPanels: readonly TAgent[];
	readonly filePanels: readonly FilePanel[];
	readonly reviewPanels: readonly ReviewPanel[];
	readonly terminalPanels: readonly TerminalPanelGroup[];
	readonly browserPanels: readonly BrowserPanel[];
	readonly gitPanels: readonly GitPanel[];
}

/**
 * Group panels by their session project path, preserving array order.
 * Groups are ordered by first appearance of each project in the panels array.
 */
export function groupPanelsByProject<T extends { sessionProjectPath: string | null }>(
	panels: readonly T[],
	projects: readonly Project[]
): AgentPanelGroup<T>[] {
	const groupMap = new Map<string, T[]>();
	const groupOrder: string[] = [];

	for (const panel of panels) {
		const key = panel.sessionProjectPath ?? "";
		const existing = groupMap.get(key);
		if (existing) {
			existing.push(panel);
		} else {
			groupMap.set(key, [panel]);
			groupOrder.push(key);
		}
	}

	return groupOrder.map((key) => {
		const groupPanels = groupMap.get(key)!;
		const project = key ? projects.find((p) => p.path === key) : null;
		return {
			projectPath: key,
			projectName: project?.name ?? key.split("/").pop() ?? "Unknown",
			projectColor: project?.color ?? "#4AD0FF",
			panels: groupPanels,
		};
	});
}

/** Resolve project metadata for a given path. */
function resolveProject(
	projectPath: string,
	projects: readonly Project[]
): { name: string; color: string } {
	const project = projectPath ? projects.find((p) => p.path === projectPath) : null;
	return {
		name: project?.name ?? projectPath.split("/").pop() ?? "Unknown",
		color: project?.color ?? "#4AD0FF",
	};
}

/** Ensure a project key exists in the group structures. */
function ensureGroup<TAgent extends { sessionProjectPath: string | null }>(
	key: string,
	groupMap: Map<string, ProjectPanelGroup<TAgent>>,
	groupOrder: string[],
	projects: readonly Project[]
): ProjectPanelGroup<TAgent> {
	let group = groupMap.get(key);
	if (!group) {
		const { name, color } = resolveProject(key, projects);
		group = {
			projectPath: key,
			projectName: name,
			projectColor: color,
			agentPanels: [],
			filePanels: [],
			reviewPanels: [],
			terminalPanels: [],
			browserPanels: [],
			gitPanels: [],
		};
		groupMap.set(key, group);
		groupOrder.push(key);
	}
	return group;
}

/**
 * Group all panel types by project path into unified groups.
 * Groups are ordered by first appearance of any panel for that project.
 */
export function groupAllPanelsByProject<TAgent extends { sessionProjectPath: string | null }>(
	agentPanels: readonly TAgent[],
	filePanels: readonly FilePanel[],
	reviewPanels: readonly ReviewPanel[],
	terminalPanels: readonly TerminalPanelGroup[],
	browserPanels: readonly BrowserPanel[],
	gitPanels: readonly GitPanel[],
	projects: readonly Project[]
): ProjectPanelGroup<TAgent>[] {
	const groupMap = new Map<string, ProjectPanelGroup<TAgent>>();
	const groupOrder: string[] = [];

	// Agent panels use sessionProjectPath
	for (const panel of agentPanels) {
		const key = panel.sessionProjectPath ?? "";
		const group = ensureGroup(key, groupMap, groupOrder, projects);
		(group.agentPanels as TAgent[]).push(panel);
	}

	// Non-agent panels use projectPath directly
	for (const panel of filePanels) {
		const key = panel.projectPath ?? "";
		const group = ensureGroup(key, groupMap, groupOrder, projects);
		(group.filePanels as FilePanel[]).push(panel);
	}

	for (const panel of reviewPanels) {
		const key = panel.projectPath ?? "";
		const group = ensureGroup(key, groupMap, groupOrder, projects);
		(group.reviewPanels as ReviewPanel[]).push(panel);
	}

	for (const panel of terminalPanels) {
		const key = panel.projectPath ?? "";
		const group = ensureGroup(key, groupMap, groupOrder, projects);
		(group.terminalPanels as TerminalPanelGroup[]).push(panel);
	}

	for (const panel of browserPanels) {
		const key = panel.projectPath ?? "";
		const group = ensureGroup(key, groupMap, groupOrder, projects);
		(group.browserPanels as BrowserPanel[]).push(panel);
	}

	for (const panel of gitPanels) {
		const key = panel.projectPath ?? "";
		const group = ensureGroup(key, groupMap, groupOrder, projects);
		(group.gitPanels as GitPanel[]).push(panel);
	}

	return groupOrder.map((key) => groupMap.get(key)!);
}

export function groupWorkspacePanelsByProject<
	TAgent extends { id: string; projectPath: string | null },
>(
	agentPanels: readonly TAgent[],
	workspacePanels: readonly WorkspacePanel[],
	reviewPanels: readonly ReviewPanel[],
	gitPanels: readonly GitPanel[],
	projects: readonly Project[]
): UnifiedWorkspacePanelGroup<TAgent>[] {
	const groupMap = new Map<
		string,
		UnifiedWorkspacePanelGroup<TAgent> & {
			agentPanels: TAgent[];
			filePanels: FilePanel[];
			reviewPanels: ReviewPanel[];
			terminalPanels: TerminalPanelGroup[];
			browserPanels: BrowserWorkspacePanel[];
			gitPanels: GitPanel[];
		}
	>();
	const groupOrder: string[] = [];

	for (const panel of agentPanels) {
		const key = panel.projectPath ?? "";
		let group = groupMap.get(key);
		if (!group) {
			const { name, color } = resolveProject(key, projects);
			group = {
				projectPath: key,
				projectName: name,
				projectColor: color,
				agentPanels: [],
				filePanels: [],
				reviewPanels: [],
				terminalPanels: [],
				browserPanels: [],
				gitPanels: [],
			};
			groupMap.set(key, group);
			groupOrder.push(key);
		}
		group.agentPanels.push(panel);
	}

	for (const panel of workspacePanels) {
		if (panel.kind === "agent") continue;
		if (panel.kind === "file" && panel.ownerPanelId !== null) continue;
		const key = panel.projectPath;
		let group = groupMap.get(key);
		if (!group) {
			const { name, color } = resolveProject(key, projects);
			group = {
				projectPath: key,
				projectName: name,
				projectColor: color,
				agentPanels: [],
				filePanels: [],
				reviewPanels: [],
				terminalPanels: [],
				browserPanels: [],
				gitPanels: [],
			};
			groupMap.set(key, group);
			groupOrder.push(key);
		}

		if (panel.kind === "file") {
			group.filePanels.push(panel);
			continue;
		}
		if (panel.kind === "terminal") {
			group.terminalPanels.push({
				id: panel.groupId,
				projectPath: panel.projectPath,
				width: panel.width,
				selectedTabId: null,
				order: group.terminalPanels.length,
			});
			continue;
		}
		if (panel.kind === "review") {
			group.reviewPanels.push(panel);
			continue;
		}
		if (panel.kind === "git") {
			group.gitPanels.push(panel);
			continue;
		}
		group.browserPanels.push(panel);
	}

	for (const panel of reviewPanels) {
		const key = panel.projectPath;
		let group = groupMap.get(key);
		if (!group) {
			const { name, color } = resolveProject(key, projects);
			group = {
				projectPath: key,
				projectName: name,
				projectColor: color,
				agentPanels: [],
				filePanels: [],
				reviewPanels: [],
				terminalPanels: [],
				browserPanels: [],
				gitPanels: [],
			};
			groupMap.set(key, group);
			groupOrder.push(key);
		}
		group.reviewPanels.push(panel);
	}

	for (const panel of gitPanels) {
		const key = panel.projectPath;
		let group = groupMap.get(key);
		if (!group) {
			const { name, color } = resolveProject(key, projects);
			group = {
				projectPath: key,
				projectName: name,
				projectColor: color,
				agentPanels: [],
				filePanels: [],
				reviewPanels: [],
				terminalPanels: [],
				browserPanels: [],
				gitPanels: [],
			};
			groupMap.set(key, group);
			groupOrder.push(key);
		}
		group.gitPanels.push(panel);
	}

	return groupOrder.map((key) => groupMap.get(key)!);
}
