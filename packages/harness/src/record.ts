import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Config from "effect/Config"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { type CompletedExchange, ingestAppLine, ingestSidecarLine, makeCorrelator } from "./correlate.ts"
import {
	encodeExchangeLine,
	fixtureFileName,
	type RecordedExchange,
	RecordedExchange as RecordedExchangeSchema,
} from "./fixture.ts"
import { redactSecrets } from "./redact.ts"

export class MissingSidecarBin extends Schema.TaggedError<MissingSidecarBin>()("MissingSidecarBin", {
	message: Schema.String,
}) {}

export type RecordArgs = {
	readonly sidecarBin: string | undefined
	readonly outDir: string | undefined
	readonly sidecarArgs: ReadonlyArray<string>
}

export type RecordConfig = {
	readonly sidecarBin: string
	readonly sidecarArgs: ReadonlyArray<string>
	readonly outDir: string
}

export type RecordTrafficInput<E = never, R = never> = {
	readonly appLines: Stream.Stream<string, E, R>
	readonly sidecarLines: Stream.Stream<string, E, R>
	readonly writeToApp: (line: string) => Effect.Effect<void, E, R>
	readonly writeToSidecar: (line: string) => Effect.Effect<void, E, R>
	readonly writeExchange: (exchange: RecordedExchange) => Effect.Effect<void, E, R>
	readonly onAppEnded: Effect.Effect<void, E, R>
}

const flagValue = (args: ReadonlyArray<string>, flag: string): string | undefined =>
	Option.match(Arr.findFirstIndex(args, (arg) => arg === flag), {
		onNone: () => undefined,
		onSome: (index) => Option.getOrUndefined(Arr.get(args, index + 1)),
	})

export const parseRecordArgs = (args: ReadonlyArray<string>): RecordArgs => {
	const dashAt = Arr.findFirstIndex(args, (arg) => arg === "--")
	const flagArgs = Option.match(dashAt, {
		onNone: () => args,
		onSome: (index) => Arr.take(args, index),
	})
	const sidecarArgs = Option.match(dashAt, {
		onNone: () => Arr.empty<string>(),
		onSome: (index) => Arr.drop(args, index + 1),
	})
	return {
		sidecarBin: flagValue(flagArgs, "--sidecar"),
		outDir: flagValue(flagArgs, "--out"),
		sidecarArgs,
	}
}

export const resolveRecordConfig = Effect.fn("resolveRecordConfig")(function* () {
	const stdio = yield* Stdio.Stdio
	const args = yield* stdio.args
	const parsed = parseRecordArgs(args)
	const sidecarFromEnv = yield* Config.option(Config.nonEmptyString("ACEPE_SIDECAR_BIN"))
	const outFromEnv = yield* Config.option(Config.nonEmptyString("ACEPE_HARNESS_OUT"))
	const sidecarCandidate = Option.orElse(Option.fromUndefinedOr(parsed.sidecarBin), () => sidecarFromEnv)
	const sidecarBin = yield* Option.match(
		Option.filter(sidecarCandidate, (bin) => Str.isNonEmpty(Str.trim(bin))),
		{
			onNone: () =>
				new MissingSidecarBin({
					message: "Pass --sidecar <bin> or set ACEPE_SIDECAR_BIN",
				}),
			onSome: (bin) => Effect.succeed(bin),
		},
	)
	const outDir = Option.getOrElse(Option.orElse(Option.fromUndefinedOr(parsed.outDir), () => outFromEnv), () => "fixtures")
	return {
		sidecarBin,
		sidecarArgs: parsed.sidecarArgs,
		outDir,
	}
})

const recordedExchangeFrom = Effect.fn("recordedExchangeFrom")(function* (completed: CompletedExchange) {
	const recordedAt = DateTime.formatIso(yield* DateTime.now)
	const exchange = yield* Schema.decodeUnknownEffect(RecordedExchangeSchema)({
		recordedAt,
		command: completed.command,
		payload: redactSecrets(completed.payload),
		response: redactSecrets(completed.response),
		notifications: Arr.map(completed.notifications, redactSecrets),
	})
	return exchange
})

const writeCompletedExchange = Effect.fn("writeCompletedExchange")(<E, R>(
	writeExchange: (exchange: RecordedExchange) => Effect.Effect<void, E, R>,
	completed: Option.Option<CompletedExchange>,
) =>
	Option.match(completed, {
		onNone: () => Effect.void,
		onSome: (done) => recordedExchangeFrom(done).pipe(Effect.andThen(writeExchange)),
	}))

export const recordTraffic = Effect.fn("recordTraffic")(function* <E, R>(input: RecordTrafficInput<E, R>) {
	const state = yield* makeCorrelator()
	const appLines = Stream.filter(input.appLines, (line) => Str.isNonEmpty(Str.trim(line)))
	const sidecarLines = Stream.filter(input.sidecarLines, (line) => Str.isNonEmpty(Str.trim(line)))
	const forwardApp = Stream.runForEach(appLines, (line) =>
		input.writeToSidecar(line).pipe(
			Effect.andThen(ingestAppLine(state, line).pipe(Effect.catchTag("SchemaError", () => Effect.void))),
		),
	).pipe(Effect.andThen(input.onAppEnded))
	const forwardSidecar = Stream.runForEach(sidecarLines, (line) =>
		input.writeToApp(line).pipe(
			Effect.andThen(
				ingestSidecarLine(state, line).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(Option.none()))),
			),
			Effect.flatMap((completed) => writeCompletedExchange(input.writeExchange, completed)),
		),
	)
	yield* Effect.all([forwardApp, forwardSidecar], { concurrency: 2 })
})

export const appendExchangeLine = Effect.fn("appendExchangeLine")(function* (
	filePath: string,
	exchange: RecordedExchange,
) {
	const fs = yield* FileSystem.FileSystem
	const line = yield* encodeExchangeLine(exchange)
	yield* fs.writeFileString(filePath, `${line}\n`, { flag: "a" })
})

export const HarnessLive = BunChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
)

export const runRecordHarness = Effect.fn("runRecordHarness")(function* () {
	const config = yield* resolveRecordConfig()
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const stdio = yield* Stdio.Stdio
	yield* fs.makeDirectory(config.outDir, { recursive: true })
	const startedAt = yield* DateTime.now
	const fixturePath = path.join(config.outDir, fixtureFileName(startedAt))
	const toSidecar = yield* Queue.unbounded<string, Done>()
	const child = yield* ChildProcess.make(config.sidecarBin, config.sidecarArgs, {
		stdin: Stream.encodeText(Stream.fromQueue(toSidecar)),
	})
	yield* Stream.run(child.stderr, stdio.stderr()).pipe(Effect.forkChild)
	yield* recordTraffic({
		appLines: stdio.stdin.pipe(Stream.decodeText, Stream.splitLines),
		sidecarLines: child.stdout.pipe(Stream.decodeText, Stream.splitLines),
		writeToApp: (line) => Stream.run(Stream.succeed(`${line}\n`), stdio.stdout()),
		writeToSidecar: (line) => Queue.offer(toSidecar, `${line}\n`).pipe(Effect.asVoid),
		writeExchange: (exchange) => appendExchangeLine(fixturePath, exchange),
		onAppEnded: Queue.end(toSidecar).pipe(Effect.asVoid),
	})
	return fixturePath
})
