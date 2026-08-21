import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import * as Str from "effect/String"

export type DirectoryEntry = {
	readonly name: string
	readonly absolute: string
}

export const isHiddenName = (name: string): boolean => {
	if (name === "." || name === "..") {
		return true
	}
	return Str.startsWith(".")(name)
}

export const modifiedAtMillis = (
	mtime: Option.Option<{ readonly getTime: () => number }>
): number =>
	Option.match(mtime, {
		onNone: () => 0,
		onSome: (value) => value.getTime()
	})

export const listChildDirectories = Effect.fn("listChildDirectories")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string
) {
	const exists = yield* fs.exists(root)
	if (exists === false) {
		return Arr.empty<DirectoryEntry>()
	}
	const info = yield* fs.stat(root)
	if (info.type !== "Directory") {
		return Arr.empty<DirectoryEntry>()
	}
	const names = yield* fs.readDirectory(root)
	const sorted = Arr.sort(names, Str.Order)
	const confirmed = yield* Effect.forEach(sorted, (name) =>
		Effect.gen(function*() {
			if (isHiddenName(name)) {
				return Option.none<DirectoryEntry>()
			}
			const absolute = path.join(root, name)
			const stat = yield* fs.stat(absolute)
			if (stat.type !== "Directory") {
				return Option.none<DirectoryEntry>()
			}
			return Option.some({
				name,
				absolute
			})
		})
	)
	return Arr.getSomes(confirmed)
})
