import * as BunServices from "@effect/platform-bun/BunServices";
import * as Arr from "effect/Array";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import {
	captureScenario,
	encodeCapturedScenario,
	parseCaptureArgs,
	writeScenarioFile,
} from "./capture.ts";
import { QaUnknownCommand } from "./errors.ts";
import { DEFAULT_HELPER_DEADLINE } from "./host/bridge-client.ts";
import { QaSocketRequest } from "./host/protocol.ts";
import type { QaSession } from "./host/session.ts";
import { loadQaSocketPath } from "./host/socket-path.ts";
import { makeRemoteSession, sendSocketRequest } from "./host/socket-server.ts";
import { HELPER_NAMES, helperHelp } from "./runtime/helpers.ts";
import { runUserScript } from "./runtime/script-runner.ts";

/**
 * `writeFile` is a seam for the same reason `session` is: a CLI test must be
 * able to run `capture` end to end without touching the real filesystem.
 */
export type CliFileWriter = (
	path: string,
	text: string,
) => Effect.Effect<void, { readonly message: string }>;

export type CliInput = {
	readonly argv: ReadonlyArray<string>;
	readonly stdin: Effect.Effect<string, QaUnknownCommand>;
	readonly session?: QaSession;
	readonly writeFile?: CliFileWriter;
};

const bunFileWriter: CliFileWriter = (path, text) =>
	// @effect-diagnostics-next-line strictEffectProvide:off
	writeScenarioFile(path, text).pipe(Effect.provide(BunServices.layer));

export type CliResult = {
	readonly code: number;
	readonly lines: ReadonlyArray<string>;
};

const helpLines = (): Array<string> => {
	const lines = [
		"electrobun-qa run | doctor | capture | help",
		"run: execute a heredoc script with QA helpers in scope",
		"doctor: report window title, url, and count",
		"capture --session <id> [--out path] [--name n] [--description d] [--quiet-ms 400]:",
		"  record the live session as a replayable QA scenario",
		"helpers:",
	];
	for (const name of HELPER_NAMES) {
		lines.push(`  ${helperHelp(name)}`);
	}
	return lines;
};

const commandOf = (argv: ReadonlyArray<string>): string =>
	Option.getOrElse(Arr.head(argv), () => "help");

const fail = (error: { readonly message: string }): CliResult => ({
	code: 1,
	lines: [error.message],
});

const ok = (lines: ReadonlyArray<string>): CliResult => ({
	code: 0,
	lines,
});

const doctorFromSocket = Effect.fn("doctorFromSocket")(function* () {
	const path = yield* loadQaSocketPath();
	const response = yield* sendSocketRequest(
		path,
		QaSocketRequest.make({ id: "1", method: "doctor" }),
		DEFAULT_HELPER_DEADLINE,
	);
	if (response.ok === true) {
		return ok([String(response.value)]);
	}
	return fail({ message: response.error.message });
});

export const executeCli = Effect.fn("executeCli")(function* (input: CliInput) {
	const command = commandOf(input.argv);
	if (command === "help" || command === "--help" || command === "-h") {
		return ok(helpLines());
	}
	if (command === "doctor") {
		if (input.session !== undefined) {
			const report = yield* Effect.result(input.session.doctor());
			if (Result.isFailure(report) === true) {
				return fail(report.failure);
			}
			return ok([report.success]);
		}
		const report = yield* Effect.result(doctorFromSocket());
		if (Result.isFailure(report) === true) {
			return fail(report.failure);
		}
		return report.success;
	}
	if (command === "run") {
		const source = yield* Effect.result(input.stdin);
		if (Result.isFailure(source) === true) {
			return fail(source.failure);
		}
		const session =
			input.session !== undefined
				? input.session
				: makeRemoteSession(yield* loadQaSocketPath());
		const logs = yield* Effect.result(runUserScript(source.success, session));
		if (Result.isFailure(logs) === true) {
			return fail(logs.failure);
		}
		return ok(logs.success);
	}
	if (command === "capture") {
		const args = yield* Effect.result(parseCaptureArgs(input.argv));
		if (Result.isFailure(args) === true) {
			return fail(args.failure);
		}
		const session =
			input.session !== undefined
				? input.session
				: makeRemoteSession(yield* loadQaSocketPath());
		const captured = yield* Effect.result(captureScenario(session, args.success));
		if (Result.isFailure(captured) === true) {
			return fail(captured.failure);
		}
		const encoded = yield* Effect.result(
			encodeCapturedScenario(args.success, captured.success),
		);
		if (Result.isFailure(encoded) === true) {
			return fail(encoded.failure);
		}
		const writeFile =
			input.writeFile !== undefined ? input.writeFile : bunFileWriter;
		const written = yield* Effect.result(
			writeFile(args.success.out, encoded.success.text),
		);
		if (Result.isFailure(written) === true) {
			return fail(written.failure);
		}
		return ok([
			`captured ${String(encoded.success.stepCount)} events from ${args.success.sessionId}`,
			`wrote ${args.success.out}`,
		]);
	}
	return fail(new QaUnknownCommand({ command }));
});

export const printCliResult = Effect.fn("printCliResult")(function* (
	result: CliResult,
) {
	yield* Effect.forEach(result.lines, (line) => Console.log(line), {
		discard: true,
	});
	return result.code;
});
