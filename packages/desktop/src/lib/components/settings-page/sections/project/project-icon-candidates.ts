import { hasProjectIconExtension } from "@acepe/contracts";

/** Names a project's own mark tends to have. */
const ICON_BASENAMES = new Set(["logo", "icon", "favicon", "mark", "brand"]);

/** Directories a project's own mark tends to live in. */
const ICON_DIRECTORIES = new Set(["", ".github", "public", "assets", "static", "docs", "brand"]);

const basenameOf = (path: string): string => {
	const file = path.slice(path.lastIndexOf("/") + 1);
	const dot = file.lastIndexOf(".");
	return (dot === -1 ? file : file.slice(0, dot)).toLowerCase();
};

const directoryOf = (path: string): string => {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
};

const depthOf = (path: string): number => path.split("/").length - 1;

/**
 * How likely a file is to be the icon someone actually wants.
 *
 * Lower sorts first. This matters more than it sounds: a monorepo that vendors
 * an icon set offers thousands of images, and this repo offers 2449. Sorting
 * them by name alone buries the project's own logo behind every file-type glyph
 * that happens to start with an earlier letter.
 */
export const projectIconRank = (path: string): number => {
	const named = ICON_BASENAMES.has(basenameOf(path));
	const conventional = ICON_DIRECTORIES.has(directoryOf(path));
	if (named && conventional) {
		return 0;
	}
	if (named) {
		return 1;
	}
	if (conventional) {
		return 2;
	}
	return 3;
};

/**
 * The project's images, most likely candidate first.
 *
 * Ties break on depth and then on name, so the ordering is total and a reload
 * shows the same grid in the same order.
 */
export const rankProjectIconCandidates = (paths: readonly string[]): string[] =>
	paths
		.filter((path) => hasProjectIconExtension(path))
		.slice()
		.sort((left, right) => {
			const byRank = projectIconRank(left) - projectIconRank(right);
			if (byRank !== 0) {
				return byRank;
			}
			const byDepth = depthOf(left) - depthOf(right);
			if (byDepth !== 0) {
				return byDepth;
			}
			return left.localeCompare(right);
		});

/** Keeps only the paths containing every whitespace-separated term. */
export const filterProjectIconCandidates = (paths: readonly string[], query: string): string[] => {
	const terms = query
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 0);
	if (terms.length === 0) {
		return paths.slice();
	}
	return paths.filter((path) => {
		const haystack = path.toLowerCase();
		return terms.every((term) => haystack.includes(term));
	});
};
