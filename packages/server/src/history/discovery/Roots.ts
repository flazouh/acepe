import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
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
