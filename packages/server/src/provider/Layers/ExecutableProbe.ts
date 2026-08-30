import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Str from "effect/String"
import type { ProviderPresence } from "../Services/ProviderAdapter.ts"

// The one PATH walk every provider adapter uses to answer "is this agent's
// CLI on this machine".
//
// It existed six times before this file — once in Claude/Provider.ts for the
// executable path, again in Claude/Provider.ts for presence, and once each in
// Cursor, Copilot and OpenCode — beside four separate HOME-relative
// credential checks. That duplication is why the same staleness bug had to be
// found per provider: presence was computed once at layer construction in
// five places, so an install or a login that changed the answer stayed
// invisible until the app restarted, and each rediscovery fixed one copy.
//
// Everything here is an Effect that reads the filesystem when it runs, never
// a value captured earlier. A caller that wants an answer asks again.

// A probe reads the filesystem to answer a question about it, and an entry it
// cannot read is, from where the operator stands, the same as one that is not
// there. Degrading a single unreadable candidate to "not found" keeps one
// unreadable PATH directory from failing the whole agent list, and is why
// nothing here has an error channel.
const existsOrFalse = (fs: FileSystem.FileSystem, candidate: string): Effect.Effect<boolean> =>
	fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))

export const optionalEnvValue = (name: string): Effect.Effect<Option.Option<string>> =>
	Config.option(Config.string(name)).pipe(Effect.orElseSucceed(() => Option.none<string>()))

/** The same read, with a blank value treated as absent. */
export const nonEmptyEnvValue = (name: string): Effect.Effect<Option.Option<string>> =>
	optionalEnvValue(name).pipe(
		Effect.map(Option.filter((value) => Str.isNonEmpty(Str.trim(value))))
	)

export const pathDirectories = Effect.fn("pathDirectories")(function*() {
	const pathVar = yield* optionalEnvValue("PATH")
	return Option.match(pathVar, {
		onNone: () => Arr.empty<string>(),
		onSome: (value) => Arr.filter(Str.split(value, ":"), (part) => Str.isNonEmpty(part))
	})
})

export type ExecutableProbe = {
	/** The file name the agent's installer puts on PATH. */
	readonly name: string
	/**
	 * An environment variable holding an absolute path that wins over PATH.
	 * None for an agent with no such override.
	 */
	readonly overrideEnvKey: Option.Option<string>
}

/**
 * The absolute path of an agent's executable: the environment override first
 * when it names a file that exists, then the first PATH entry that holds one.
 * None means the CLI is not installed.
 */
export const resolveExecutable = Effect.fn("resolveExecutable")(function*(probe: ExecutableProbe) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	if (Option.isSome(probe.overrideEnvKey)) {
		const override = yield* nonEmptyEnvValue(probe.overrideEnvKey.value)
		if (Option.isSome(override)) {
			const exists = yield* existsOrFalse(fs, override.value)
			if (exists) {
				return Option.some(override.value)
			}
		}
	}
	const directories = yield* pathDirectories()
	return yield* Effect.reduce(directories, () => Option.none<string>(), (found, directory) => {
		if (Option.isSome(found)) {
			return Effect.succeed(found)
		}
		const candidate = path.join(directory, probe.name)
		return existsOrFalse(fs, candidate).pipe(
			Effect.map((exists) => (exists ? Option.some(candidate) : Option.none<string>()))
		)
	})
})

export const resolveExecutableOnPath = (
	name: string
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> =>
	resolveExecutable({ name, overrideEnvKey: Option.none() })

export const resolveOverridableExecutable = (
	name: string,
	overrideEnvKey: string
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> =>
	resolveExecutable({ name, overrideEnvKey: Option.some(overrideEnvKey) })

/**
 * Whether a file exists under the operator's home directory. Every adapter
 * that reads authenticatedness off a credential store on disk asks this, so
 * the "no HOME means not authenticated" answer is decided once.
 */
export const homeRelativeFileExists = Effect.fn("homeRelativeFileExists")(function*(
	relativePath: string
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const home = yield* optionalEnvValue("HOME")
	if (Option.isNone(home)) {
		return false
	}
	return yield* existsOrFalse(fs, path.join(home.value, relativePath))
})

/**
 * Binds the filesystem services a probe needs and hands back the probe itself,
 * still unrun.
 *
 * The services are bound, the answer is not. `Effect.succeed(yield* probe)`
 * reads the disk once while the layer is being built and returns that value
 * forever, which is what made a managed install report "not installed" and a
 * finished login report "not authenticated" until the app was restarted.
 *
 * The same distinction decides where an agent's binary is found. An adapter
 * that resolves its executable at construction launches the placeholder it saw
 * then, however the disk has changed since.
 */
export const bindProbe = <A, E>(
	probe: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
): Effect.Effect<Effect.Effect<A, E>, never, FileSystem.FileSystem | Path.Path> =>
	Effect.all([FileSystem.FileSystem, Path.Path]).pipe(
		Effect.map(([fs, path]) =>
			probe.pipe(
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.provideService(Path.Path, path)
			)
		)
	)

/**
 * Turns a presence probe into the `presence` member of a ProviderAdapter.
 *
 * The returned Effect carries no requirements, which is what
 * ProviderAdapter.presence asks for, and it still runs the probe every time it
 * is evaluated.
 */
export const bindPresence = (
	probe: Effect.Effect<ProviderPresence, never, FileSystem.FileSystem | Path.Path>
): Effect.Effect<Effect.Effect<ProviderPresence>, never, FileSystem.FileSystem | Path.Path> =>
	bindProbe(probe)
