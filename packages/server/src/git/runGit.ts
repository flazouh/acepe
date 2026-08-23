import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { GitCommandError } from "./Errors.ts"

export type RunCommandInput = {
	readonly bin: string
	readonly args: ReadonlyArray<string>
	readonly cwd: string
	readonly allowExitCodes: ReadonlyArray<number>
	readonly env: Option.Option<Readonly<Record<string, string>>>
}

export type RunCommandResult = {
	readonly stdout: string
	readonly stderr: string
	readonly exitCode: number
}

const collectOutput = Effect.fn("collectOutput")(function*(
	handle: ChildProcessSpawner.ChildProcessHandle
) {
	const [stdout, stderr] = yield* Effect.zip(
		handle.stdout.pipe(Stream.decodeText, Stream.mkString),
		handle.stderr.pipe(Stream.decodeText, Stream.mkString),
		{ concurrent: true }
	)
	const branded = yield* handle.exitCode
	return {
		stdout,
		stderr,
		exitCode: branded
	} satisfies RunCommandResult
})

export const runCommandUsing = Effect.fn("runCommandUsing")(function*(
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
	input: RunCommandInput
) {
	const base = ChildProcess.make(input.bin, Arr.fromIterable(input.args), {
		cwd: input.cwd
	})
	const command = Option.match(input.env, {
		onNone: () => base,
		onSome: (env) => ChildProcess.setEnv(base, env)
	})
	const result = yield* Effect.scoped(spawner.spawn(command).pipe(Effect.flatMap(collectOutput)))
	const allowed =
		result.exitCode === 0 || Arr.contains(input.allowExitCodes, result.exitCode) === true
	if (allowed === false) {
		return yield* new GitCommandError({
			bin: input.bin,
			args: input.args,
			cwd: input.cwd,
			exitCode: result.exitCode,
			stderr: result.stderr.trim()
		})
	}
	return result
})

export const runCommand = Effect.fn("runCommand")(function*(input: RunCommandInput) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	return yield* runCommandUsing(spawner, input)
})

export const runGitUsing = Effect.fn("runGitUsing")(function*(
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
	input: {
		readonly gitBin: string
		readonly args: ReadonlyArray<string>
		readonly cwd: string
		readonly allowExitCodes: ReadonlyArray<number>
		readonly env: Option.Option<Readonly<Record<string, string>>>
	}
) {
	const result = yield* runCommandUsing(spawner, {
		bin: input.gitBin,
		args: Arr.appendAll(Arr.of("--no-pager"), input.args),
		cwd: input.cwd,
		allowExitCodes: input.allowExitCodes,
		env: input.env
	})
	return result.stdout
})

export const runGit = Effect.fn("runGit")(function*(input: {
	readonly gitBin: string
	readonly args: ReadonlyArray<string>
	readonly cwd: string
	readonly allowExitCodes: ReadonlyArray<number>
	readonly env: Option.Option<Readonly<Record<string, string>>>
}) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	return yield* runGitUsing(spawner, input)
})
