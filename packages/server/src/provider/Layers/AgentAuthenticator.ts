import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Ref from "effect/Ref"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	AgentAuthenticator,
	AgentSignInBinaryMissingError,
	AgentSignInCancelledError,
	AgentSignInRejectedError,
	AgentSignInSpawnFailedError,
	AgentSignInUnavailableError
} from "../Services/AgentAuthenticator.ts"
import type { ProviderId } from "../Services/ProviderAdapter.ts"
import { type AgentSignInPlan, signInPlanForAgent } from "../signIn.ts"

const pathEntries = (pathVar: string): ReadonlyArray<string> =>
	Arr.filter(Str.split(pathVar, ":"), (part) => Str.isNonEmpty(part))

// The env override first and then PATH, the same order and the same shape as
// every adapter's own binary probe (probeCopilotBinary, probeCursorBinary,
// resolveClaudeExecutablePath). A login has to run the CLI the operator
// installed, so this deliberately does not look in Acepe's managed agent
// cache: what lives there is the ACP server entry point, and its login
// subcommand is not what a managed download is for.
const resolveSignInBinary = Effect.fn("AgentAuthenticator.resolveSignInBinary")(function*(
	binaryName: string,
	binaryEnvKey: string | null
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	if (binaryEnvKey !== null) {
		const override = yield* Config.option(Config.nonEmptyString(binaryEnvKey))
		if (Option.isSome(override)) {
			const exists = yield* fs.exists(override.value)
			if (exists) {
				return Option.some(override.value)
			}
		}
	}
	const pathVar = yield* Config.option(Config.string("PATH"))
	const directories = Option.match(pathVar, {
		onNone: () => Arr.empty<string>(),
		onSome: pathEntries
	})
	return yield* Effect.reduce(directories, () => Option.none<string>(), (found, directory) => {
		if (Option.isSome(found)) {
			return Effect.succeed(found)
		}
		const candidate = path.join(directory, binaryName)
		return fs
			.exists(candidate)
			.pipe(Effect.map((exists) => (exists ? Option.some(candidate) : Option.none<string>())))
	})
})

// All three streams are closed off, on purpose.
//
// stdin: a login CLI that wants a terminal must fail rather than sit forever
// on a prompt nobody can answer, and none of the browser flows here needs an
// answer typed at it.
//
// stdout and stderr: this is where a login CLI prints one-time codes and
// authorization URLs. Acepe does not read them, so it cannot log them, put
// them in an error or forward them anywhere. Nothing is lost that Acepe is
// allowed to use.
//
// `detached` is left at the platform default (true on macOS and Linux), which
// is what lets the spawner kill the whole process group when a sign-in is
// cancelled -- a login CLI that has spawned a browser helper leaves one.
const signInCommand = (binaryPath: string, args: ReadonlyArray<string>): ChildProcess.Command =>
	ChildProcess.make(binaryPath, Arr.fromIterable(args), {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore"
	})

export const makeAgentAuthenticator = Effect.fn("AgentAuthenticator.make")(function*() {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	// One cancel latch per agent with a sign-in in flight. Not a process
	// handle: cancelling means interrupting the effect that owns the child,
	// and the spawner's own scope kills the process group from there.
	const inFlight = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<void>>())

	const runBrowserSignIn = Effect.fn("AgentAuthenticator.runBrowserSignIn")(function*(
		agentId: ProviderId,
		plan: Extract<AgentSignInPlan, { readonly kind: "browser" }>
	) {
		const binary = yield* resolveSignInBinary(plan.binaryName, plan.binaryEnvKey)
		if (Option.isNone(binary)) {
			return yield* new AgentSignInBinaryMissingError({ agentId, binaryName: plan.binaryName })
		}
		const binaryPath = binary.value
		const cancelled = yield* Deferred.make<void>()
		// A second sign-in for the same agent stops the first rather than
		// leaving two login children racing to write the same credential
		// store.
		const previous = yield* Ref.get(inFlight).pipe(Effect.map(HashMap.get(agentId)))
		if (Option.isSome(previous)) {
			yield* Deferred.succeed(previous.value, undefined)
		}
		yield* Ref.update(inFlight, HashMap.set(agentId, cancelled))
		const exitCode = yield* Effect.raceFirst(
			spawner.exitCode(signInCommand(binaryPath, plan.args)).pipe(
				Effect.mapError(() => new AgentSignInSpawnFailedError({ agentId, binaryPath }))
			),
			Deferred.await(cancelled).pipe(
				Effect.andThen(Effect.fail(new AgentSignInCancelledError({ agentId })))
			)
		).pipe(
			Effect.ensuring(Ref.update(inFlight, HashMap.remove(agentId)))
		)
		if (Number(exitCode) !== 0) {
			return yield* new AgentSignInRejectedError({ agentId, exitCode: Number(exitCode) })
		}
	})

	const signIn = Effect.fn("AgentAuthenticator.signIn")(function*(agentId: ProviderId) {
		const plan = signInPlanForAgent(agentId)
		if (plan.kind === "manual") {
			return yield* new AgentSignInUnavailableError({
				agentId,
				instructions: plan.instructions
			})
		}
		return yield* runBrowserSignIn(agentId, plan)
	})

	const cancel = Effect.fn("AgentAuthenticator.cancel")(function*(agentId: ProviderId) {
		const running = yield* Ref.get(inFlight).pipe(Effect.map(HashMap.get(agentId)))
		if (Option.isNone(running)) {
			return false
		}
		yield* Deferred.succeed(running.value, undefined)
		return true
	})

	return { signIn, cancel } as const
})

export const AgentAuthenticatorLive = Layer.effect(AgentAuthenticator, makeAgentAuthenticator())
