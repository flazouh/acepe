import * as Schema from "effect/Schema"

/**
 * A project's place in the sidebar, as an integer rank: the first project is 0,
 * the next 1, and so on.
 *
 * A move renumbers the whole visible list and writes back the rank of every
 * project whose position changed, so the ranks come out dense and the next move
 * can read them straight back. Deleting a project leaves a gap, which the next
 * move closes; only the relative order matters in between. Sparse ranks
 * would let a move touch fewer rows, but they drift apart until two neighbours
 * have no integer between them and the whole list has to be renumbered anyway.
 * A sidebar holds a handful of projects, so dense is the cheaper rule.
 *
 * null means nobody has ever ordered this project. Such a project sorts after
 * every ranked one, which is where a freshly added project belongs.
 */
export const ProjectSortOrder = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export type ProjectSortOrder = typeof ProjectSortOrder.Type
