import * as Arr from "effect/Array"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"

import { QaUnknownCommand } from "./errors.ts"
import { type QaSession } from "./host/session.ts"
import { loadQaSocketPath } from "./host/socket-path.ts"
import { makeRemoteSession, sendSocketRequest } from "./host/socket-server.ts"
import { QaSocketRequest } from "./host/protocol.ts"
import { DEFAULT_HELPER_DEADLINE } from "./host/bridge-client.ts"
import { HELPER_NAMES, helperHelp } from "./runtime/helpers.ts"
import { runUserScript } from "./runtime/script-runner.ts"

export type CliInput = {
	readonly argv: ReadonlyArray<string>
	readonly stdin: Effect.Effect<string, QaUnknownCommand>
	readonly session?: QaSession
}

export type CliResult = {
	readonly code: number
	readonly lines: ReadonlyArray<string>
}

const helpLines = (): Array<string> => {
	const lines = [
		"electrobun-qa run | doctor | help",
		"run: execute a heredoc script with QA helpers in scope",
		"doctor: report window title, url, and count",
		"helpers:",
	]
	for (const name of HELPER_NAMES) {
		lines.push(`  ${helperHelp(name)}`)
	}
	return lines
}

const commandOf = (argv: ReadonlyArray<string>): string => Option.getOrElse(Arr.head(argv), () => "help")

const fail = (error: { readonly message: string }): CliResult => ({
	code: 1,
	lines: [error.message],
})

const ok = (lines: ReadonlyArray<string>): CliResult => ({
	code: 0,
	lines,
})

const doctorFromSocket = Effect.fn("doctorFromSocket")(function* () {
	const path = yield* loadQaSocketPath()
	const response = yield* sendSocketRequest(
		path,
		QaSocketRequest.make({ id: "1", method: "doctor" }),
		DEFAULT_HELPER_DEADLINE,
	)
	if (response.ok === true) {
		return ok([String(response.value)])
	}
	return fail({ message: response.error.message })
})

export const executeCli = Effect.fn("executeCli")(function* (input: CliInput) {
	const command = commandOf(input.argv)
	if (command === "help" || command === "--help" || command === "-h") {
		return ok(helpLines())
	}
	if (command === "doctor") {
		if (input.session !== undefined) {
			const report = yield* Effect.result(input.session.doctor())
			if (Result.isFailure(report) === true) {
				return fail(report.failure)
			}
			return ok([report.success])
		}
		const report = yield* Effect.result(doctorFromSocket())
		if (Result.isFailure(report) === true) {
			return fail(report.failure)
		}
		return report.success
	}
	if (command === "run") {
		const source = yield* Effect.result(input.stdin)
		if (Result.isFailure(source) === true) {
			return fail(source.failure)
		}
		const session =
			input.session !== undefined ? input.session : makeRemoteSession(yield* loadQaSocketPath())
		const logs = yield* Effect.result(runUserScript(source.success, session))
		if (Result.isFailure(logs) === true) {
			return fail(logs.failure)
		}
		return ok(logs.success)
	}
	return fail(new QaUnknownCommand({ command }))
})

export const printCliResult = Effect.fn("printCliResult")(function* (result: CliResult) {
	yield* Effect.forEach(result.lines, (line) => Console.log(line), { discard: true })
	return result.code
})

const readStdin = Effect.tryPromise({
	try: () => Bun.stdin.text(),
	catch: (cause) =>
		new QaUnknownCommand({
			command: Predicate.isError(cause) === true ? cause.message : "stdin",
		}),
})

const isMain = (meta: ImportMeta): boolean => "main" in meta && meta.main === true

const runMain = Effect.fn("runMain")(function* () {
	const argv = Bun.argv.slice(2)
	const result = yield* executeCli({
		argv,
		stdin: readStdin,
	})
	return yield* printCliResult(result)
})

if (isMain(import.meta) === true) {
	const code = await Effect.runPromise(runMain())
	if (code !== 0) {
		process.exit(code)
	}
}
