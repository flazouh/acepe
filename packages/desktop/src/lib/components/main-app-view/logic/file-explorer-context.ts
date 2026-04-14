import type { Project } from "$lib/acp/logic/project-manager.svelte.js";

export interface FileExplorerProjectInfo {
	name: string;
	color: string;
	iconSrc: string | null;
}

export function buildFileExplorerProjectPaths(
	projects: readonly Project[],
	focusedProjectPath: string | null,
	focusedWorktreePath: string | null
): string[] {
	const orderedPaths: string[] = [];
	const excludedPaths = new Set<string>();
	const preferredPath = focusedWorktreePath ? focusedWorktreePath : focusedProjectPath;

	if (focusedProjectPath) {
		excludedPaths.add(focusedProjectPath);
	}
	if (focusedWorktreePath) {
		excludedPaths.add(focusedWorktreePath);
	}
	if (preferredPath) {
		orderedPaths.push(preferredPath);
	}

	for (const project of projects) {
		if (excludedPaths.has(project.path)) {
			continue;
		}
		orderedPaths.push(project.path);
	}

	return orderedPaths;
}

export function buildFileExplorerProjectInfoByPath(
	projects: readonly Project[],
	focusedProjectPath: string | null,
	focusedWorktreePath: string | null
): Record<string, FileExplorerProjectInfo> {
	const info: Record<string, FileExplorerProjectInfo> = {};
	let focusedProjectInfo: FileExplorerProjectInfo | null = null;

	for (const project of projects) {
		const projectInfo: FileExplorerProjectInfo = {
			name: project.name,
			color: project.color,
			iconSrc: project.iconPath ?? null,
		};
		info[project.path] = projectInfo;
		if (focusedProjectPath && project.path === focusedProjectPath) {
			focusedProjectInfo = projectInfo;
		}
	}

	if (focusedWorktreePath && focusedProjectInfo) {
		info[focusedWorktreePath] = {
			name: focusedProjectInfo.name,
			color: focusedProjectInfo.color,
			iconSrc: focusedProjectInfo.iconSrc,
		};
	}

	return info;
}
