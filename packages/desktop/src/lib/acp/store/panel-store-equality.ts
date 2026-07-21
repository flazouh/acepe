/**
 * Pure equality helpers used by PanelStore reactive equality checks.
 */

import type { BrowserPanel } from "./browser-panel-type.js";
import type { FilePanel } from "./file-panel-type.js";
import type { Panel, TerminalPanelGroup, WorkspacePanel } from "./types.js";

export interface TopLevelPanelProjectRef {
	readonly id: string;
	readonly projectPath: string | null;
}

export function areFilePanelListsEqual(
	left: readonly FilePanel[] | undefined,
	right: readonly FilePanel[]
): boolean {
	if (left === undefined || left.length !== right.length) {
		return false;
	}
	return left.every(
		(panel, index) =>
			panel.id === right[index]?.id &&
			panel.filePath === right[index]?.filePath &&
			panel.projectPath === right[index]?.projectPath &&
			panel.ownerPanelId === right[index]?.ownerPanelId &&
			panel.width === right[index]?.width &&
			panel.targetLine === right[index]?.targetLine &&
			panel.targetColumn === right[index]?.targetColumn
	);
}

export function areBrowserPanelListsEqual(
	left: readonly BrowserPanel[] | undefined,
	right: readonly BrowserPanel[]
): boolean {
	if (left === undefined || left.length !== right.length) {
		return false;
	}
	return left.every(
		(panel, index) =>
			panel.id === right[index]?.id &&
			panel.projectPath === right[index]?.projectPath &&
			panel.url === right[index]?.url &&
			panel.title === right[index]?.title &&
			panel.width === right[index]?.width
	);
}

export function areAgentPanelListsEqual(
	left: readonly Panel[] | undefined,
	right: readonly Panel[]
): boolean {
	if (left === undefined || left.length !== right.length) {
		return false;
	}
	return left.every(
		(panel, index) =>
			panel.id === right[index]?.id &&
			panel.sessionId === right[index]?.sessionId &&
			panel.width === right[index]?.width &&
			panel.pendingProjectSelection === right[index]?.pendingProjectSelection &&
			panel.pendingWorktreeEnabled === right[index]?.pendingWorktreeEnabled &&
			panel.preparedWorktreeLaunch === right[index]?.preparedWorktreeLaunch &&
			panel.selectedAgentId === right[index]?.selectedAgentId &&
			panel.projectPath === right[index]?.projectPath &&
			panel.agentId === right[index]?.agentId &&
			panel.sourcePath === right[index]?.sourcePath &&
			panel.worktreePath === right[index]?.worktreePath &&
			panel.sessionTitle === right[index]?.sessionTitle &&
			panel.autoCreated === right[index]?.autoCreated
	);
}

export function areTerminalPanelGroupListsEqual(
	left: readonly TerminalPanelGroup[] | undefined,
	right: readonly TerminalPanelGroup[]
): boolean {
	if (left === undefined || left.length !== right.length) {
		return false;
	}
	return left.every(
		(group, index) =>
			group.id === right[index]?.id &&
			group.projectPath === right[index]?.projectPath &&
			group.width === right[index]?.width &&
			group.selectedTabId === right[index]?.selectedTabId &&
			group.order === right[index]?.order
	);
}

export function areWorkspacePanelListsEqual(
	left: readonly WorkspacePanel[],
	right: readonly WorkspacePanel[]
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every(
		(panel, index) =>
			panel.id === right[index]?.id &&
			panel.kind === right[index]?.kind &&
			panel.projectPath === right[index]?.projectPath &&
			panel.ownerPanelId === right[index]?.ownerPanelId &&
			panel.width === right[index]?.width &&
			(panel.kind !== "agent" ||
				right[index]?.kind !== "agent" ||
				panel.autoCreated === right[index]?.autoCreated)
	);
}

export function arePanelProjectRefListsEqual(
	left: readonly TopLevelPanelProjectRef[],
	right: readonly TopLevelPanelProjectRef[]
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(ref, index) => ref.id === right[index]?.id && ref.projectPath === right[index]?.projectPath
		)
	);
}
