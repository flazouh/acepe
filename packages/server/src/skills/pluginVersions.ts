import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Str from "effect/String"

const parseVersionPart = (part: string): Option.Option<number> => {
	if (part.length === 0) {
		return Option.none()
	}
	let index = 0
	while (index < part.length) {
		const code = part.charCodeAt(index)
		if (code < 48 || code > 57) {
			return Option.none()
		}
		index = index + 1
	}
	return Option.some(Number.parseInt(part, 10))
}

const versionParts = (version: string): ReadonlyArray<number> =>
	Arr.getSomes(Arr.map(Str.split(version, "."), parseVersionPart))

export const comparePluginVersions = (left: string, right: string): -1 | 0 | 1 => {
	const leftParts = versionParts(left)
	const rightParts = versionParts(right)
	if (leftParts.length > 0 && rightParts.length > 0) {
		const shared = Math.min(leftParts.length, rightParts.length)
		let index = 0
		while (index < shared) {
			const leftValue = leftParts[index]
			const rightValue = rightParts[index]
			if (leftValue === undefined || rightValue === undefined) {
				break
			}
			if (leftValue > rightValue) {
				return 1
			}
			if (leftValue < rightValue) {
				return -1
			}
			index = index + 1
		}
		if (leftParts.length > rightParts.length) {
			return 1
		}
		if (leftParts.length < rightParts.length) {
			return -1
		}
		return 0
	}
	if (left > right) {
		return 1
	}
	if (left < right) {
		return -1
	}
	return 0
}

export const latestPluginVersion = (versions: ReadonlyArray<string>): Option.Option<string> =>
	Arr.reduce(versions, Option.none<string>(), (best, current) =>
		Option.match(best, {
			onNone: () => Option.some(current),
			onSome: (value) =>
				comparePluginVersions(current, value) > 0 ? Option.some(current) : best
		})
	)
