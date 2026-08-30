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
 * One path segment: anything but a separator, and never "." or "..".
 *
 * Written positively rather than as a negative lookahead. Effect derives
 * fast-check arbitraries from these patterns, and a lookahead makes that
 * derivation fail outright ("Assertions of kind Lookahead not implemented
 * yet"), which takes down every property test that generates a project.
 *
 * The three alternatives are: a segment starting with an ordinary character,
 * one starting with a dot followed by an ordinary character (".github"), and
 * one starting with two dots followed by more (a file honestly named
 * "..rc.png"). Bare "." and bare ".." match none of them.
 */
const SEGMENT = "([^/\\\\.][^/\\\\]*|\\.[^/\\\\.][^/\\\\]*|\\.\\.[^/\\\\]+)";

const RELATIVE_PATH_PATTERN = new RegExp(`^${SEGMENT}(/${SEGMENT})*$`);

/**
 * Where an icon lives, written relative to the project's workspace root.
 *
 * Relative on purpose. The Tauri-era column stored an absolute path, which tied
 * a row to one machine's directory layout and went stale the moment the
 * checkout moved. A relative path means the same repository cloned twice, or
 * opened on a second machine, still finds its own icon.
 *
 * The structure check keeps a stored choice inside the project: a leading "/"
 * fails the first segment, a ".." segment matches nothing, and a backslash is
 * not a separator on the only platform this runs on. Note that it rejects a
 * ".." *segment*, not the two characters anywhere, so a file called
 * "v1..2.png" is still choosable.
 */
export const ProjectIconRelativePath = TrimmedNonEmptyString.pipe(
	Schema.check(
		Schema.isPattern(RELATIVE_PATH_PATTERN, {
			title: "a path inside the project, with no `..` segment",
		}),
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
