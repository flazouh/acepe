/**
 * Shared project utilities for color fallbacks and project maps.
 */

import { TAG_COLORS } from "@acepe/ui/colors";

import type { Project } from "../logic/project-manager.svelte.js";

/**
 * Generate a fallback color for a project based on its path.
 * Used when actual project color is not available (e.g. before project is loaded from DB).
 */
export function generateFallbackProjectColor(projectPath: string): string {
	let hash = 0;
	for (let i = 0; i < projectPath.length; i++) {
		hash = (hash << 5) - hash + projectPath.charCodeAt(i);
		hash |= 0;
	}
	return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

/**
 * Creates a map of project paths to colors.
 */
export function createProjectColorMap(projects: readonly Project[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const project of projects) {
		if (project.color) {
			map.set(project.path, project.color);
		}
	}
	return map;
}

/**
 * Creates a map of project paths to names.
 */
export function createProjectNameMap(projects: readonly Project[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const project of projects) {
		map.set(project.path, project.name);
	}
	return map;
}
