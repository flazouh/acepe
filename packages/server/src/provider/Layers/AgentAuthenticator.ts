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
	AgentSignInAlreadyRunningError,
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
// `detached: false` matches agentChildProcess (provider/AgentEnv.ts), which
// every other agent child is spawned with: a login left running when Acepe
// quits would otherwise outlive it with nothing able to answer it. Cancelling
// still works -- the spawner tries a process-group kill first and falls back
// to killing the process itself, which is the path a non-detached child takes.
const signInCommand = (binaryPath: string, args: ReadonlyArray<string>): ChildProcess.Command =>
	ChildProcess.make(binaryPath, Arr.fromIterable(args), {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		detached: false
	})

export const makeAgentAuthenticator = Effect.fn("AgentAuthenticator.make")(function*() {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	// One cancel latch per agent with a sign-in in flight. Not a process
	// handle: cancelling means interrupting the effect that owns the child,
	// and the spawner's own scope kills the process group from there.
	const inFlight = yield* Ref.make(HashMap.empty<ProviderId, Deferred.Deferred<void>>())

	// A path that cannot be read is a path with no binary on it, not a
	// failure of its own: every branch here answers Option.none() rather than
	// turning an unreadable PATH entry into a sign-in error that says nothing
	// about signing in.
	const existingFile = (candidate: string) =>
		fs.exists(candidate).pipe(
			Effect.orElseSucceed(() => false),
			Effect.map((exists) => (exists ? Option.some(candidate) : Option.none<string>()))
		)

	const readEnv = (key: string) =>
		Config.option(Config.nonEmptyString(key)).pipe(
			Effect.orElseSucceed(() => Option.none<string>())
		)

	// The env override first and then PATH, the same order and the same shape
	// as every adapter's own binary probe (probeCopilotBinary,
	// probeCursorBinary, resolveClaudeExecutablePath). A login has to run the
	// CLI the operator installed, so this deliberately does not look in
	// Acepe's managed agent cache: what lives there is the ACP server entry
	// point, and its login subcommand is not what a managed download is for.
	const resolveSignInBinary = Effect.fn("AgentAuthenticator.resolveSignInBinary")(function*(
		binaryName: string,
		binaryEnvKey: string | null
	) {
		if (binaryEnvKey !== null) {
			const override = yield* readEnv(binaryEnvKey)
			if (Option.isSome(override)) {
				const found = yield* existingFile(override.value)
				if (Option.isSome(found)) {
					return found
				}
			}
		}
		const pathVar = yield* readEnv("PATH")
		const directories = Option.match(pathVar, {
			onNone: () => Arr.empty<string>(),
			onSome: pathEntries
		})
		return yield* Effect.reduce(directories, () => Option.none<string>(), (found, directory) =>
			Option.isSome(found)
				? Effect.succeed(found)
				: existingFile(path.join(directory, binaryName)))
	})

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
		// One sign-in per agent at a time, claimed atomically. Two login
		// children racing to write the same credential store is not a thing
		// to arbitrate between, and cancel can only name an agent, so a
		// second latch under the same key would leave one of them
		// unstoppable.
		const claimed = yield* Ref.modify(inFlight, (running) =>
			HashMap.has(running, agentId)
				? [false, running]
				: [true, HashMap.set(running, agentId, cancelled)])
		if (claimed === false) {
			return yield* new AgentSignInAlreadyRunningError({ agentId })
		}
		const exit = yield* Effect.raceFirst(
			spawner.exitCode(signInCommand(binaryPath, plan.args)).pipe(
				Effect.mapError((cause) =>
					new AgentSignInSpawnFailedError({ agentId, binaryPath, detail: cause.message }))
			),
			Deferred.await(cancelled).pipe(
				Effect.andThen(Effect.fail(new AgentSignInCancelledError({ agentId })))
			)
		).pipe(
			Effect.ensuring(Ref.update(inFlight, HashMap.remove(agentId))),
			Effect.map(Number)
		)
		if (exit !== 0) {
			return yield* new AgentSignInRejectedError({ agentId, exitCode: exit })
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
		yield* runBrowserSignIn(agentId, plan)
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
