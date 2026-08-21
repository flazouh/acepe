import { JsonRpcFailure, JsonRpcSuccess } from "@acepe/sidecar"
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { type CompletedExchange, ingestAppLine, ingestSidecarLine, makeCorrelator } from "./correlate.ts"
import { decodeExchangeLine, encodeJsonLine, type RecordedExchange } from "./fixture.ts"
import { gradeExchange, skipExchange } from "./grade.ts"
import { HarnessLive } from "./record.ts"
import { formatReport, makeReport, type FixtureReport } from "./report.ts"

export { HarnessLive }

export class MissingFixture extends Schema.TaggedError<MissingFixture>()("MissingFixture", {
	message: Schema.String,
}) {}

export class MissingAgainst extends Schema.TaggedError<MissingAgainst>()("MissingAgainst", {
	message: Schema.String,
}) {}

export class GradeFailed extends Schema.TaggedError<GradeFailed>()("GradeFailed", {
	message: Schema.String,
	path: Schema.String,
}) {}

export type ReplayArgs = {
	readonly fixture: string | undefined
	readonly against: string | undefined
	readonly implArgs: ReadonlyArray<string>
	readonly skipCommands: ReadonlyArray<string>
}

export type ReplayConfig = {
	readonly fixture: string
	readonly implBin: string
	readonly implArgs: ReadonlyArray<string>
	readonly skipCommands: ReadonlyArray<string>
}

export type ReplayTrafficInput<E = never, R = never> = {
	readonly exchanges: ReadonlyArray<RecordedExchange>
	readonly implLines: Stream.Stream<string, E, R>
	readonly writeToImpl: (line: string) => Effect.Effect<void, E, R>
	readonly onFinished: Effect.Effect<void, E, R>
	readonly skipCommands: ReadonlyArray<string>
	readonly responseTimeout: Duration.Duration
}

const REPLAY_FLAGS = HashSet.fromIterable(["--against", "--skip"])

const flagValue = (args: ReadonlyArray<string>, flag: string): string | undefined =>
	Option.match(Arr.findFirstIndex(args, (arg) => arg === flag), {
		onNone: () => undefined,
		onSome: (index) => Option.getOrUndefined(Arr.get(args, index + 1)),
	})

const parseSkipCommands = (raw: string | undefined): ReadonlyArray<string> => {
	if (raw === undefined) {
		return Arr.empty()
	}
	return Arr.filter(Arr.map(Str.split(raw, ","), Str.trim), (part) => Str.isNonEmpty(part))
}

export const parseReplayArgs = (args: ReadonlyArray<string>): ReplayArgs => {
	const withoutCommand = Option.match(Arr.head(args), {
		onNone: () => args,
		onSome: (head) => (head === "replay" || head === "record" ? Arr.drop(args, 1) : args),
	})
	const dashAt = Arr.findFirstIndex(withoutCommand, (arg) => arg === "--")
	const flagArgs = Option.match(dashAt, {
		onNone: () => withoutCommand,
		onSome: (index) => Arr.take(withoutCommand, index),
	})
	const implArgs = Option.match(dashAt, {
		onNone: () => Arr.empty<string>(),
		onSome: (index) => Arr.drop(withoutCommand, index + 1),
	})
	const collected = Arr.reduce(flagArgs, { skipValue: false, positionals: Arr.empty<string>() }, (state, arg) => {
		if (state.skipValue === true) {
			return { skipValue: false, positionals: state.positionals }
		}
		if (HashSet.has(REPLAY_FLAGS, arg) === true) {
			return { skipValue: true, positionals: state.positionals }
		}
		return { skipValue: false, positionals: Arr.append(state.positionals, arg) }
	})
	return {
		fixture: Option.getOrUndefined(Arr.head(collected.positionals)),
		against: flagValue(flagArgs, "--against"),
		implArgs,
		skipCommands: parseSkipCommands(flagValue(flagArgs, "--skip")),
	}
}

export const resolveReplayConfig = Effect.fn("resolveReplayConfig")(function* () {
	const stdio = yield* Stdio.Stdio
	const args = yield* stdio.args
	const parsed = parseReplayArgs(args)
	const againstFromEnv = yield* Config.option(Config.nonEmptyString("ACEPE_SIDECAR_BIN"))
	const fixture = yield* Option.match(Option.fromUndefinedOr(parsed.fixture).pipe(Option.filter(Str.isNonEmpty)), {
		onNone: () =>
			new MissingFixture({
				message: "Pass a fixture path: bun harness replay <fixture> --against <impl>",
			}),
		onSome: (path) => Effect.succeed(path),
	})
	const againstCandidate = Option.orElse(Option.fromUndefinedOr(parsed.against), () => againstFromEnv)
	const implBin = yield* Option.match(
		Option.filter(againstCandidate, (bin) => Str.isNonEmpty(Str.trim(bin))),
		{
			onNone: () =>
				new MissingAgainst({
					message: "Pass --against <impl> or set ACEPE_SIDECAR_BIN",
				}),
			onSome: (bin) => Effect.succeed(bin),
		},
	)
	return {
		fixture,
		implBin,
		implArgs: parsed.implArgs,
		skipCommands: parsed.skipCommands,
	}
})

const jsonRpcIdFromResponse = Effect.fn("jsonRpcIdFromResponse")(function* (response: Schema.Json) {
	const asSuccess = yield* Effect.option(Schema.decodeUnknownEffect(JsonRpcSuccess)(response))
	if (Option.isSome(asSuccess)) {
		return Option.some(asSuccess.value.id)
	}
	const asFailure = yield* Effect.option(Schema.decodeUnknownEffect(JsonRpcFailure)(response))
	if (Option.isSome(asFailure) && asFailure.value.id !== null) {
		return Option.some(asFailure.value.id)
	}
	return Option.none<string | number>()
})

export const requestLineFromExchange = Effect.fn("requestLineFromExchange")(function* (
	exchange: RecordedExchange,
) {
	const id = yield* jsonRpcIdFromResponse(exchange.response)
	if (Option.isNone(id)) {
		return Option.none<string>()
	}
	const line = yield* encodeJsonLine({
		jsonrpc: "2.0",
		id: id.value,
		method: exchange.command,
		params: exchange.payload,
	})
	return Option.some(line)
})

export const loadFixture = Effect.fn("loadFixture")(function* (filePath: string) {
	const fs = yield* FileSystem.FileSystem
	const body = yield* fs.readFileString(filePath)
	const lines = yield* Stream.make(body).pipe(
		Stream.splitLines,
		Stream.filter((line) => Str.isNonEmpty(Str.trim(line))),
		Stream.runCollect,
	)
	return yield* Effect.forEach(lines, decodeExchangeLine)
})

export const replayTraffic = Effect.fn("replayTraffic")(function* <E, R>(input: ReplayTrafficInput<E, R>) {
	const state = yield* makeCorrelator()
	const completed = yield* Queue.unbounded<CompletedExchange, Done>()
	const implLines = Stream.filter(input.implLines, (line) => Str.isNonEmpty(Str.trim(line)))
	yield* Stream.runForEach(implLines, (line) =>
		ingestSidecarLine(state, line).pipe(
			Effect.catchTag("SchemaError", () => Effect.succeed(Option.none())),
			Effect.flatMap((done) =>
				Option.match(done, {
					onNone: () => Effect.void,
					onSome: (exchange) => Queue.offer(completed, exchange).pipe(Effect.asVoid),
				}),
			),
		),
	).pipe(Effect.forkChild)
	const grades = yield* Effect.forEach(input.exchanges, (exchange, index) =>
		Effect.gen(function* () {
			if (Arr.contains(input.skipCommands, exchange.command) === true) {
				return gradeExchange(index, exchange, Option.none(), input.skipCommands)
			}
			const requestLine = yield* requestLineFromExchange(exchange)
			if (Option.isNone(requestLine)) {
				return skipExchange(index, exchange.command, "recorded response has no jsonrpc id")
			}
			yield* ingestAppLine(state, requestLine.value)
			yield* input.writeToImpl(requestLine.value)
			const done = yield* Queue.take(completed).pipe(Effect.timeoutOption(input.responseTimeout))
			return gradeExchange(index, exchange, done, Arr.empty())
		}),
	)
	yield* input.onFinished
	return grades
})

const firstDivergencePath = (report: FixtureReport): string =>
	Option.match(report.firstDivergence, {
		onNone: () => "unknown",
		onSome: (divergence) => divergence.path,
	})

export const runReplayHarness = Effect.fn("runReplayHarness")(function* () {
	const config = yield* resolveReplayConfig()
	const path = yield* Path.Path
	const stdio = yield* Stdio.Stdio
	const exchanges = yield* loadFixture(config.fixture)
	const toImpl = yield* Queue.unbounded<string, Done>()
	const child = yield* ChildProcess.make(config.implBin, config.implArgs, {
		stdin: Stream.encodeText(Stream.fromQueue(toImpl)),
	})
	yield* Stream.run(child.stderr, stdio.stderr()).pipe(Effect.forkChild)
	const grades = yield* replayTraffic({
		exchanges,
		implLines: child.stdout.pipe(Stream.decodeText, Stream.splitLines),
		writeToImpl: (line) => Queue.offer(toImpl, `${line}\n`).pipe(Effect.asVoid),
		onFinished: Queue.end(toImpl).pipe(Effect.asVoid),
		skipCommands: config.skipCommands,
		responseTimeout: Duration.seconds(30),
	})
	const report = makeReport(path.basename(config.fixture), grades)
	const text = yield* formatReport(report)
	yield* Console.log(text)
	if (report.fail > 0) {
		const divergencePath = firstDivergencePath(report)
		return yield* new GradeFailed({
			message: `unexplained difference at ${divergencePath}`,
			path: divergencePath,
		})
	}
	return report
})
