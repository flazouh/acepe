import {
	hasProjectIconExtension,
	PROJECT_ICON_EXTENSIONS,
} from "@acepe/contracts";

/**
 * Where a project keeps its own logo, most conventional first.
 *
 * "" is the workspace root. The rest are the directories a repository actually
 * puts brand assets in.
 */
const ICON_DIRECTORIES = ["", ".github", "public", "assets", "static"] as const;

/** What such a file is called, most specific to the project first. */
const ICON_BASENAMES = ["logo", "icon", "favicon"] as const;

/**
 * Which format wins when a project ships several.
 *
 * `svg` first because it stays sharp at every badge size. `ico` after the
 * raster formats because it is usually a 16px browser favicon, which looks
 * poor scaled up.
 */
const ICON_EXTENSIONS = [
	"svg",
	"png",
	"webp",
	"jpg",
	"jpeg",
	"gif",
	"ico",
] as const;

/** Monorepo layouts whose packages are worth searching when the root has none. */
const WORKSPACE_DIRECTORIES = ["packages", "apps"] as const;

const join = (...segments: ReadonlyArray<string>): string =>
	segments.filter((segment) => segment.length > 0).join("/");

/**
 * Every place a project icon could live, in the order we would rather have it.
 *
 * The Tauri implementation wrote this out as a 26-entry string literal, and a
 * second 13-entry one for workspace packages, which is why the two lists had
 * drifted apart: the root list looked for `.ico` in four directories, the
 * package list in one. Generating both from the same three rankings keeps them
 * honest, and adding a format or a directory is now a one-word change.
 */
export const projectIconCandidates = (
	directories: ReadonlyArray<string> = ICON_DIRECTORIES,
): ReadonlyArray<string> => {
	const candidates: Array<string> = [];
	for (const directory of directories) {
		for (const basename of ICON_BASENAMES) {
			for (const extension of ICON_EXTENSIONS) {
				candidates.push(join(directory, `${basename}.${extension}`));
			}
		}
	}
	return candidates;
};

/**
 * Reads a project without touching the filesystem, so detection stays pure.
 *
 * `isFile` answers for a path relative to the workspace root. `listDirectories`
 * answers with the immediate subdirectory names of one relative path, and with
 * an empty list when the path is missing or unreadable.
 */
export interface ProjectTree {
	readonly isFile: (relativePath: string) => boolean;
	readonly listDirectories: (relativePath: string) => ReadonlyArray<string>;
}

/**
 * Find the icon a project would pick for itself, as a workspace-relative path.
 *
 * Looks in the project root first. Only if nothing turns up there does it walk
 * the packages of a monorepo, in name order, and take the first package that
 * has one. A monorepo's own root logo should beat any single package's.
 *
 * Returns null when the project has no image worth showing, which is the
 * common case and is not an error.
 */
export const detectProjectIcon = (tree: ProjectTree): string | null => {
	for (const candidate of projectIconCandidates()) {
		if (tree.isFile(candidate)) {
			return candidate;
		}
	}

	for (const workspaceDirectory of WORKSPACE_DIRECTORIES) {
		const packageNames = [...tree.listDirectories(workspaceDirectory)].sort();
		for (const packageName of packageNames) {
			const packageRoot = join(workspaceDirectory, packageName);
			for (const candidate of projectIconCandidates()) {
				const relativePath = join(packageRoot, candidate);
				if (tree.isFile(relativePath)) {
					return relativePath;
				}
			}
		}
	}

	return null;
};

/** True when `relativePath` is an image a project icon may point at. */
export const isProjectIconFile = (relativePath: string): boolean =>
	hasProjectIconExtension(relativePath);

export { PROJECT_ICON_EXTENSIONS };
