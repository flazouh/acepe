/**
 * Shared project utilities for color fallbacks and project maps.
 */

import { defaultProjectColor } from "@acepe/contracts";
import { resolveProjectColor } from "@acepe/ui/colors";

import type { Project } from "../logic/project-manager.svelte.js";

/**
 * Generate a fallback color for a project based on its path.
 * Used by session, tab, and queue surfaces that hold a path but no project row.
 * Delegates to the canonical derivation so a surface that never found its
 * project still shows the color the projection would have given it.
 */
export function generateFallbackProjectColor(projectPath: string): string {
	return resolveProjectColor(defaultProjectColor(projectPath));
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
