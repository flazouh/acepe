import * as Schema from "effect/Schema"

/**
 * Canonical project color vocabulary.
 *
 * A project color is a name, not a hex value. The palette belongs to the theme,
 * so a stored name stays correct when a theme changes the hex behind it.
 * `@acepe/ui` owns the name-to-hex mapping (packages/ui/src/lib/colors.ts) and
 * must keep the same names in the same order.
 */
export const PROJECT_COLORS = [
	"red",
	"orange",
	"amber",
	"yellow",
	"lime",
	"green",
	"teal",
	"cyan",
	"blue",
	"indigo",
	"purple",
	"pink"
] as const

export const ProjectColor = Schema.Literals(PROJECT_COLORS)
export type ProjectColor = typeof ProjectColor.Type

/**
 * Color a project gets before anyone picks one.
 *
 * Derived from the workspace root so the color survives a restart, a reinstall,
 * and a projection rebuild, and so two checkouts of the same repository stay
 * visually distinct.
 */
export const defaultProjectColor = (workspaceRoot: string): ProjectColor => {
	let hash = 0
	for (let index = 0; index < workspaceRoot.length; index++) {
		hash = (hash << 5) - hash + workspaceRoot.charCodeAt(index)
		hash |= 0
	}
	return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length] ?? PROJECT_COLORS[0]
}
