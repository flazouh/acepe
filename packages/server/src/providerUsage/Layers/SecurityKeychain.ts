import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { SecurityKeychain } from "../Services/SecurityKeychain.ts"

const SECURITY_TIMEOUT = Duration.seconds(5)

// A restricted PATH -- the caller never needs anything beyond the system
// `security` binary, and this keeps the spawned process from picking up an
// unexpected shell-configured PATH.
const SECURITY_ENV = { PATH: "/usr/bin:/bin" }

const findGenericPasswordArgs = (input: { readonly service: string; readonly account?: string }) => {
	const base = ["find-generic-password", "-w", "-s", input.service]
	return input.account === undefined ? base : Arr.append(Arr.append(base, "-a"), input.account)
}

// Runs `security find-generic-password -w ...` and returns the password on
// a clean exit, Option.none() on anything else -- not found, access denied,
// a stalled TCC authorization prompt past the timeout, or a spawn failure.
// Never fails: the caller (ProviderUsageService) treats "no credential" as
// "this provider is unavailable", not as an RPC-level error.
const runFindGenericPassword = Effect.fn("providerUsage.runFindGenericPassword")(
	function*(spawner: ChildProcessSpawner.ChildProcessSpawner["Service"], input: { readonly service: string; readonly account?: string }) {
		const outcome = yield* Effect.scoped(
			Effect.gen(function*() {
				const handle = yield* spawner.spawn(
					ChildProcess.make("security", findGenericPasswordArgs(input), {
						env: SECURITY_ENV,
						extendEnv: false,
					}),
				)
				const stdout = yield* Stream.decodeText(handle.stdout).pipe(Stream.mkString)
				const exitCode = yield* handle.exitCode
				return { stdout, exitCode: Number(exitCode) }
			}),
		).pipe(
			Effect.timeout(SECURITY_TIMEOUT),
			Effect.orElseSucceed(() => ({ stdout: "", exitCode: 1 })),
		)

		if (outcome.exitCode !== 0) {
			return Option.none()
		}
		const trimmed = outcome.stdout.trim()
		return trimmed.length === 0 ? Option.none() : Option.some(trimmed)
	},
)

export const SecurityKeychainLive = Layer.effect(
	SecurityKeychain,
	Effect.gen(function*() {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		return SecurityKeychain.of({
			findGenericPassword: (input) => runFindGenericPassword(spawner, input),
		})
	}),
)
