import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import type { ProjectIcon } from "@acepe/contracts";

import { detectProjectIcon, type ProjectTree } from "./projectIconDetection.ts";

/**
 * Reads a real project directory for the detector.
 *
 * Every filesystem error reads as "not there". A project on an unplugged
 * volume, or one whose directory the user cannot read, should fall back to its
 * letter badge, not fail the sidebar.
 */
export const projectTreeAt = (workspaceRoot: string): ProjectTree => ({
	isFile: (relativePath) => {
		try {
			return NodeFs.statSync(
				NodePath.join(workspaceRoot, relativePath),
			).isFile();
		} catch {
			return false;
		}
	},
	listDirectories: (relativePath) => {
		try {
			return NodeFs.readdirSync(NodePath.join(workspaceRoot, relativePath), {
				withFileTypes: true,
			})
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
		} catch {
			return [];
		}
	},
});

/**
 * Keeps a resolved icon for as long as the answer is likely to hold.
 *
 * Detection is up to a hundred `stat` calls per project, and the snapshot query
 * runs on every read. Caching in memory rather than in the projection is the
 * point of the redesign: the answer is cheap to recompute and always matches
 * what is on disk after a restart, where a stored path could not.
 */
const resolvedIcons = new Map<string, Map<string, string | null>>();

/**
 * Keyed by project, then by choice.
 *
 * Nested rather than one flat key built by joining the two: a workspace root
 * may contain whatever character the separator picked, and an ambiguous key
 * would let two projects read each other's answer. Nesting also makes
 * forgetting one project a single delete.
 */
const choiceKey = (icon: ProjectIcon): string =>
	icon.kind === "custom" ? `custom:${icon.path}` : icon.kind;

/** Drop what we resolved for a project, so the next read looks again. */
export const forgetResolvedProjectIcon = (workspaceRoot: string): void => {
	resolvedIcons.delete(workspaceRoot);
};

const resolveUncached = (
	workspaceRoot: string,
	icon: ProjectIcon,
): string | null => {
	if (icon.kind === "none") {
		return null;
	}

	if (icon.kind === "custom") {
		// A stored pick can go stale: the file gets renamed or deleted while the
		// choice survives. Falling back to the letter badge is the honest
		// answer. Re-detecting here would silently replace the user's pick with
		// something they did not choose.
		const absolute = NodePath.join(workspaceRoot, icon.path);
		try {
			return NodeFs.statSync(absolute).isFile() ? absolute : null;
		} catch {
			return null;
		}
	}

	const detected = detectProjectIcon(projectTreeAt(workspaceRoot));
	return detected === null ? null : NodePath.join(workspaceRoot, detected);
};

/**
 * The picture a project shows right now, as an absolute path, or null for the
 * letter badge.
 *
 * This is the one place the choice and the filesystem meet. Everything
 * downstream, the RPC included, receives an answer rather than the two halves
 * of a question, so no component ever has to write `custom ?? detected`.
 */
export const resolveProjectIcon = (
	workspaceRoot: string,
	icon: ProjectIcon,
): string | null => {
	const key = choiceKey(icon);
	const forProject = resolvedIcons.get(workspaceRoot);
	const cached = forProject?.get(key);
	if (cached !== undefined) {
		return cached;
	}
	const resolved = resolveUncached(workspaceRoot, icon);
	if (forProject === undefined) {
		resolvedIcons.set(workspaceRoot, new Map([[key, resolved]]));
	} else {
		forProject.set(key, resolved);
	}
	return resolved;
};
