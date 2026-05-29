/**
 * Pure project-ordering helpers for the session list.
 *
 * Extracted verbatim from session-list-ui.svelte. All functions are pure over
 * the provided `sessionGroups` array — no reactive state or side effects.
 */

import type { SessionGroup } from "./session-list-types.js";

export function getProjectGroupByPath(
	sessionGroups: SessionGroup[],
	projectPath: string
): SessionGroup | null {
	for (const group of sessionGroups) {
		if (group.projectPath === projectPath) {
			return group;
		}
	}

	return null;
}

export function getCurrentProjectOrder(sessionGroups: SessionGroup[]): string[] {
	const orderedPaths: string[] = [];
	for (const group of sessionGroups) {
		orderedPaths.push(group.projectPath);
	}

	return orderedPaths;
}

export function isProjectOrderUnchanged(
	sessionGroups: SessionGroup[],
	orderedPaths: string[]
): boolean {
	if (orderedPaths.length !== sessionGroups.length) {
		return false;
	}

	for (let index = 0; index < orderedPaths.length; index += 1) {
		if (orderedPaths[index] !== sessionGroups[index]?.projectPath) {
			return false;
		}
	}

	return true;
}

export function getMovedProjectOrder(
	sessionGroups: SessionGroup[],
	projectPath: string,
	offset: -1 | 1
): string[] | null {
	const orderedPaths = getCurrentProjectOrder(sessionGroups);
	const currentIndex = orderedPaths.indexOf(projectPath);
	const nextIndex = currentIndex + offset;

	if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedPaths.length) {
		return null;
	}

	const currentPath = orderedPaths[currentIndex];
	const nextPath = orderedPaths[nextIndex];

	if (currentPath === undefined || nextPath === undefined) {
		return null;
	}

	orderedPaths[currentIndex] = nextPath;
	orderedPaths[nextIndex] = currentPath;

	return orderedPaths;
}
