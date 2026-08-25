import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"

/**
 * Read-time provider discovery roots (#249 batch 3).
 *
 * Ports the exact path conventions the Rust indexer used
 * (`session_jsonl/parser/text_utils.rs`): the Claude root defaults to
 * `~/.claude` but honors a `CLAUDE_HOME` override, and project directories
 * live under `<root>/projects/<slug>` where the slug replaces both `/` and
 * `.` with `-`. Matching the env var name (rather than inventing an
 * ACEPE_-prefixed one) means a QA run can point both the Rust and the TS
 * side at the same fake home directory with a single override.
 */

export const CLAUDE_HOME_DIR_NAME = ".claude"
export const CLAUDE_PROJECTS_DIR_NAME = "projects"

export const claudeHomeRoot = Effect.fn("claudeHomeRoot")(function*() {
	const path = yield* Path.Path
	const override = yield* Config.option(Config.string("CLAUDE_HOME"))
	if (Option.isSome(override)) {
		return override.value
	}
	const home = yield* Config.string("HOME")
	return path.join(home, CLAUDE_HOME_DIR_NAME)
})

export const claudeProjectsRoot = Effect.fn("claudeProjectsRoot")(function*() {
	const path = yield* Path.Path
	const home = yield* claudeHomeRoot()
	return path.join(home, CLAUDE_PROJECTS_DIR_NAME)
})

/**
 * Claude Code replaces both `/` and `.` with `-` when it builds the slug
 * directory name for a project (`text_utils.rs::path_to_slug`).
 * `/Users/example/.acepe/worktrees/foo` -> `-Users-example--acepe-worktrees-foo`.
 */
export const pathToSlug = (projectPath: string): string => projectPath.replaceAll(/[/.]/g, "-")

/**
 * Slugs a registered project path for matching against Claude Code's own
 * on-disk project directories. Claude Code slugs the realpath it observed
 * when a session started, not whatever path the caller passed it -- on
 * macOS, `/tmp` is a symlink to `/private/tmp`, so a project registered as
 * `/tmp/acepe` slugs differently from the `/private/tmp/acepe` directory
 * Claude actually wrote history under, and a literal `pathToSlug` on the
 * registered path never finds it.
 *
 * Resolves `projectPath` through `fs.realPath` first so both spellings slug
 * identically, and falls back to the path as given when realpath fails (the
 * workspace root was removed, permissions, no such path yet, ...) --
 * discovery already treats a slug directory that does not exist as the
 * normal "no history yet" case, not an error, and a path with no symlink
 * component round-trips through realpath unchanged, so this never changes
 * matching for the common non-symlinked case.
 */
export const claudeProjectSlug = Effect.fn("claudeProjectSlug")(function*(
	fs: FileSystem.FileSystem,
	projectPath: string
) {
	const resolved = yield* fs.realPath(projectPath).pipe(Effect.option)
	return pathToSlug(Option.getOrElse(resolved, () => projectPath))
})

/**
 * Reverse of `pathToSlug`, ported from `text_utils.rs::extract_project_path`.
 * Lossy on purpose: a slug cannot tell a literal `-` apart from a folded `/`
 * or `.`, so a project path with a literal dash round-trips imperfectly.
 * That is the existing Rust behavior, not a new bug introduced here.
 */
export const slugToPath = (slug: string): string => {
	if (slug.startsWith("-")) {
		return slug.replaceAll("-", "/")
	}
	return `/${slug.replaceAll("-", "/")}`
}
