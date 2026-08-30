import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Image formats a project icon may use.
 *
 * The webview renders the file straight from disk, so this list is what the
 * webview can decode, not what the filesystem happens to hold.
 */
export const PROJECT_ICON_EXTENSIONS = [
	"svg",
	"png",
	"ico",
	"webp",
	"jpg",
	"jpeg",
	"gif",
] as const;

export const ProjectIconExtension = Schema.Literals(PROJECT_ICON_EXTENSIONS);
export type ProjectIconExtension = typeof ProjectIconExtension.Type;

const EXTENSION_PATTERN = new RegExp(
	`\\.(${PROJECT_ICON_EXTENSIONS.join("|")})$`,
	"i",
);

/**
 * Where an icon lives, written relative to the project's workspace root.
 *
 * Relative on purpose. The Tauri-era column stored an absolute path, which tied
 * a row to one machine's directory layout and went stale the moment the
 * checkout moved. A relative path means the same repository cloned twice, or
 * opened on a second machine, still finds its own icon.
 *
 * The checks below keep a stored choice inside the project. `..` and an
 * absolute path both escape the workspace root, and a backslash is a separator
 * on the platform this never ran on, so all three are rejected here rather than
 * guarded again at every read.
 */
export const ProjectIconRelativePath = TrimmedNonEmptyString.pipe(
	Schema.check(
		Schema.isPattern(/^[^/]/, {
			title: "relative to the workspace root, not absolute",
		}),
		Schema.isPattern(/^(?!.*\.\.)/, { title: "free of `..` segments" }),
		Schema.isPattern(/^[^\\]*$/, { title: "separated by `/`, not `\\`" }),
		Schema.isPattern(EXTENSION_PATTERN, {
			title: `an image the webview can render (${PROJECT_ICON_EXTENSIONS.join(", ")})`,
		}),
	),
);
export type ProjectIconRelativePath = typeof ProjectIconRelativePath.Type;

/**
 * Nobody has chosen, so the server detects one from the project's own files.
 *
 * This is where every project starts, including every row that predates the
 * icon columns, and it is why the migration needs no backfill.
 */
export const ProjectIconAuto = Schema.Struct({
	kind: Schema.Literal("auto"),
});
export type ProjectIconAuto = typeof ProjectIconAuto.Type;

/** Someone picked this file. Detection does not run and cannot override it. */
export const ProjectIconCustom = Schema.Struct({
	kind: Schema.Literal("custom"),
	path: ProjectIconRelativePath,
});
export type ProjectIconCustom = typeof ProjectIconCustom.Type;

/**
 * Someone wants the letter badge and means it.
 *
 * Distinct from `auto` for one reason: under `auto` the server would detect the
 * icon again and put back exactly the picture the user just rejected. The
 * Tauri-era design had no way to say this, so "Reset to letter badge" only ever
 * un-set a custom pick and let detection win.
 */
export const ProjectIconNone = Schema.Struct({
	kind: Schema.Literal("none"),
});
export type ProjectIconNone = typeof ProjectIconNone.Type;

/**
 * A project's icon choice: canonical, and the only part of an icon that is
 * stored.
 *
 * The resolved picture is not here. That is derived from this choice plus what
 * is on disk right now, and it is computed on read. Storing a detected path is
 * what let the old `projects.icon_path` column outlive the file it named.
 */
export const ProjectIcon = Schema.Union([
	ProjectIconAuto,
	ProjectIconCustom,
	ProjectIconNone,
]);
export type ProjectIcon = typeof ProjectIcon.Type;

export const PROJECT_ICON_AUTO: ProjectIcon = { kind: "auto" };
export const PROJECT_ICON_NONE: ProjectIcon = { kind: "none" };

/** True when `path` names a file the webview can render as an icon. */
export const hasProjectIconExtension = (path: string): boolean =>
	EXTENSION_PATTERN.test(path);
