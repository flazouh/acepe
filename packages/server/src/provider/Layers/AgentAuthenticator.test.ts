import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { AgentAuthenticator } from "../Services/AgentAuthenticator.ts"
import { ProviderId } from "../Services/ProviderAdapter.ts"
import { AgentAuthenticatorLive } from "./AgentAuthenticator.ts"

const PlatformLive = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const TestLive = AgentAuthenticatorLive.pipe(Layer.provideMerge(PlatformLive))

// The authenticator finds a login command on PATH, so each test names the
// PATH it wants instead of inheriting the machine's -- otherwise a test
// would run the operator's real `codex login`.
const withEnv = <A, E, R>(program: Effect.Effect<A, E, R>, env: Record<string, string>) =>
	Effect.provideService(program, ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env }))

// A stand-in for a login CLI: a script named exactly what the plan looks for,
// on a PATH of its own. `body` decides what that login does.
const fakeLoginOnPath = Effect.fn("fakeLoginOnPath")(function*(
	binaryName: string,
	body: string
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const dir = yield* fs.makeTempDirectoryScoped()
	const binaryPath = path.join(dir, binaryName)
	yield* fs.writeFileString(binaryPath, `#!/bin/sh\n${body}\n`)
	yield* fs.chmod(binaryPath, 0o755)
	return { dir, binaryPath }
})

const CODEX = ProviderId.make("codex")
const OPENCODE = ProviderId.make("opencode")

Vitest.layer(TestLive)("AgentAuthenticator", (it) => {
	it.effect("signs in by running the agent's own login command", () =>
		Effect.gen(function*() {
			// The script writes a marker file, which is how the test sees that
			// the real login command ran rather than something reporting that
			// it had.
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const ran = path.join(yield* fs.makeTempDirectoryScoped(), "ran")
			const { dir } = yield* fakeLoginOnPath("codex", `printf ok > ${ran}`)
			const authenticator = yield* AgentAuthenticator
			yield* withEnv(authenticator.signIn(CODEX), { PATH: dir })
			Vitest.assert.strictEqual(yield* fs.readFileString(ran), "ok")
		}))

	it.effect("fails with what the login actually did when it exits non-zero", () =>
		Effect.gen(function*() {
			const { dir } = yield* fakeLoginOnPath("codex", "exit 7")
			const authenticator = yield* AgentAuthenticator
			const error = yield* withEnv(authenticator.signIn(CODEX), { PATH: dir }).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "AgentSignInRejectedError")
			Vitest.assert.include(error.message, "code 7")
			// The failure names the cause, not the call. This is the exact
			// regression the sign-in button had: "unsupported on contract"
			// told a person the name of a missing method.
			Vitest.assert.notInclude(error.message, "unsupported")
		}))

	it.effect("says the CLI is missing rather than reporting a failed login", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const empty = yield* fs.makeTempDirectoryScoped()
			const authenticator = yield* AgentAuthenticator
			const error = yield* withEnv(authenticator.signIn(CODEX), { PATH: empty }).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "AgentSignInBinaryMissingError")
			Vitest.assert.include(error.message, "codex")
			Vitest.assert.include(error.message, "PATH")
		}))

	it.effect("refuses an agent whose login it cannot drive, saying what to run instead", () =>
		Effect.gen(function*() {
			const authenticator = yield* AgentAuthenticator
			const error = yield* withEnv(authenticator.signIn(OPENCODE), { PATH: "/nonexistent" }).pipe(
				Effect.flip
			)
			Vitest.assert.strictEqual(error._tag, "AgentSignInUnavailableError")
			Vitest.assert.include(error.message, "opencode auth login")
		}))

	it.effect("cancel stops a sign-in that is waiting on the browser step", () =>
		Effect.gen(function*() {
			// A login that never returns on its own, which is what one waiting
			// on a browser looks like. Only a cancel ends this.
			const { dir } = yield* fakeLoginOnPath("codex", "sleep 30")
			const authenticator = yield* AgentAuthenticator
			const signIn = yield* Effect.forkChild(
				withEnv(authenticator.signIn(CODEX), { PATH: dir }).pipe(Effect.flip)
			)
			// The child has to be spawned and registered before a cancel can
			// find it; poll rather than sleep a guessed amount.
			const cancelled = yield* Effect.retry(
				Effect.flatMap(authenticator.cancel(CODEX), (stopped) =>
					stopped ? Effect.succeed(true) : Effect.fail("not yet" as const)),
				{ times: 200 }
			)
			Vitest.assert.strictEqual(cancelled, true)
			const error = yield* Fiber.join(signIn)
			Vitest.assert.strictEqual(error._tag, "AgentSignInCancelledError")
		}))

	it.effect("cancel says so when no sign-in is running", () =>
		Effect.gen(function*() {
			const authenticator = yield* AgentAuthenticator
			Vitest.assert.strictEqual(yield* authenticator.cancel(CODEX), false)
		}))
})
