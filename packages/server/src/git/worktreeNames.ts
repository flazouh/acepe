import * as Arr from "effect/Array"

export const WORKTREE_ADJECTIVES = [
	"brave",
	"calm",
	"clever",
	"cosmic",
	"crisp",
	"curious",
	"eager",
	"gentle",
	"golden",
	"happy",
	"keen",
	"lively",
	"merry",
	"noble",
	"proud",
	"quick",
	"quiet",
	"rapid",
	"sharp",
	"silent",
	"smooth",
	"steady",
	"swift",
	"vivid",
	"warm",
	"wise",
	"witty",
	"zesty",
	"bold",
	"bright",
	"clear",
	"cool"
] as const

export const WORKTREE_NOUNS = [
	"cabin",
	"canyon",
	"comet",
	"eagle",
	"falcon",
	"forest",
	"harbor",
	"island",
	"meadow",
	"mountain",
	"ocean",
	"panther",
	"phoenix",
	"planet",
	"river",
	"shadow",
	"spark",
	"stream",
	"summit",
	"thunder",
	"tiger",
	"valley",
	"wave",
	"willow",
	"breeze",
	"cloud",
	"crystal",
	"dawn",
	"ember",
	"frost",
	"garden",
	"horizon"
] as const

export const isWorktreeName = (name: string): boolean => {
	const parts = name.split("-")
	const adjective = parts[0]
	const noun = parts[1]
	if (adjective === undefined || noun === undefined || parts.length !== 2) {
		return false
	}
	return (
		Arr.contains(WORKTREE_ADJECTIVES, adjective) === true &&
		Arr.contains(WORKTREE_NOUNS, noun) === true
	)
}
