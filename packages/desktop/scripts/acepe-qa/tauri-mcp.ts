import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import { fromPromise } from "@acepe/effect-result/fromPromise";
import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const TAURI_MCP_CLI_VERSION = "@hypothesi/tauri-mcp-cli@0.10.0";
const DAEMON_PROTOCOL_VERSION = "v3";
const DAEMON_START_TIMEOUT_MS = 2_500;
const DAEMON_REQUEST_TIMEOUT_MS = 5_000;

export type CommandExecution = {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
};

export type TauriMcpFailure = {
	readonly code: string;
	readonly message: string;
	readonly raw?: string;
};

export type CommandRunner = (
	command: readonly string[]
) => Effect.Effect<CommandExecution, TauriMcpFailure>;

const tauriTextWrapperSchema = Schema.Struct({
	content: Schema.optionalKey(
		Schema.Array(Schema.Struct({ text: Schema.optionalKey(Schema.String) }))
	),
	text: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const tauriScreenshotWrapperSchema = Schema.Struct({
	files: Schema.optionalKey(Schema.Array(Schema.Struct({ path: Schema.String }))),
	content: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				type: Schema.optionalKey(Schema.String),
				path: Schema.optionalKey(Schema.String),
				text: Schema.optionalKey(Schema.String),
			})
		)
	),
	text: Schema.optionalKey(Schema.String),
});

const daemonResponseSchema = Schema.Struct({
	ok: Schema.Boolean,
	code: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
	stdout: Schema.optionalKey(Schema.String),
	stderr: Schema.optionalKey(Schema.String),
	text: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				type: Schema.optionalKey(Schema.String),
				text: Schema.optionalKey(Schema.String),
				path: Schema.optionalKey(Schema.String),
				data: Schema.optionalKey(Schema.String),
				mimeType: Schema.optionalKey(Schema.String),
			})
		)
	),
	files: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({ path: Schema.String, mimeType: Schema.optionalKey(Schema.String) })
		)
	),
	message: Schema.optionalKey(Schema.String),
});

type DaemonResponse = typeof daemonResponseSchema.Type;

const decodeTauriTextWrapper = decodeUnknown(tauriTextWrapperSchema, (error) => ({
	code: "tauri_wrapper_parse_failed",
	message: error.message,
}));

const decodeTauriScreenshotWrapper = decodeUnknown(tauriScreenshotWrapperSchema, (error) => ({
	code: "screenshot_payload_schema_failed",
	message: error.message,
}));

const decodeDaemonResponse = decodeUnknown(daemonResponseSchema, (error) => ({
	code: "qa_daemon_response_schema_failed",
	message: error.message,
}));

function schemaFailure(
	code: string,
	error: { readonly message: string },
	raw?: string
): TauriMcpFailure {
	if (raw === undefined) {
		return { code, message: error.message };
	}
	return { code, message: error.message, raw };
}

export function runCommand(
	command: readonly string[]
): Effect.Effect<CommandExecution, TauriMcpFailure> {
	return fromPromise(
		() =>
			(async () => {
				const child = Bun.spawn(Array.from(command), {
					stdout: "pipe",
					stderr: "pipe",
				});
				const stdout = await new Response(child.stdout).text();
				const stderr = await new Response(child.stderr).text();
				const code = await child.exited;
				return {
					code,
					stdout,
					stderr,
				};
			})(),
		(error) => {
			const message = error instanceof Error ? error.message : "Command failed.";
			return {
				code: "command_failed",
				message,
			};
		}
	);
}

function daemonSocketPath(): string {
	const digest = createHash("sha1")
		.update(`${process.cwd()}:${DAEMON_PROTOCOL_VERSION}`)
		.digest("hex")
		.slice(0, 12);
	return join(tmpdir(), `acepe-qa-daemon-${digest}.sock`);
}

function daemonScriptPath(): string {
	return join(process.cwd(), "scripts", "acepe-qa-daemon.mjs");
}

function valueAfter(args: readonly string[], flag: string): string | null {
	const index = args.indexOf(flag);
	if (index < 0) {
		return null;
	}
	return args[index + 1] ?? null;
}

const parseDaemonJson = fromThrowable(
	(input: string) => JSON.parse(input) as object,
	(error) => new Error(error instanceof Error ? error.message : "Daemon JSON parse failed.")
);

function daemonRequest(
	payload: object,
	options?: { readonly timeoutMs?: number }
): Effect.Effect<DaemonResponse, TauriMcpFailure> {
	return fromPromise(
		() =>
			new Promise<DaemonResponse>((resolve, reject) => {
				const socket = new Socket();
				let buffer = "";
				const timeout = setTimeout(() => {
					socket.destroy();
					reject(new Error("Acepe QA daemon request timed out."));
				}, options?.timeoutMs ?? DAEMON_REQUEST_TIMEOUT_MS);
				socket.on("data", (chunk) => {
					buffer += chunk.toString("utf8");
					const newlineIndex = buffer.indexOf("\n");
					if (newlineIndex < 0) {
						return;
					}
					clearTimeout(timeout);
					socket.end();
					const raw = buffer.slice(0, newlineIndex);
					const parsed = Effect.runSync(Effect.result(parseDaemonJson(raw)));
					if (Result.isFailure(parsed)) {
						reject(parsed.failure);
						return;
					}
					const response = decodeDaemonResponse(parsed.success);
					if (Result.isFailure(response)) {
						reject(new Error(response.failure.message));
						return;
					}
					resolve(response.success);
				});
				socket.on("error", reject);
				socket.connect(daemonSocketPath(), () => {
					socket.write(`${JSON.stringify(payload)}\n`);
				});
			}),
		(error) => ({
			code: "qa_daemon_request_failed",
			message: error instanceof Error ? error.message : "Acepe QA daemon request failed.",
		})
	);
}

function waitForDaemon(readyPath: string): Effect.Effect<null, TauriMcpFailure> {
	return fromPromise(
		() =>
			new Promise<null>((resolve, reject) => {
				const started = Date.now();
				const tick = () => {
					if (existsSync(readyPath)) {
						resolve(null);
						return;
					}
					if (Date.now() - started > DAEMON_START_TIMEOUT_MS) {
						reject(new Error("Acepe QA daemon did not become ready."));
						return;
					}
					setTimeout(tick, 40);
				};
				tick();
			}),
		(error) => ({
			code: "qa_daemon_start_failed",
			message: error instanceof Error ? error.message : "Acepe QA daemon did not become ready.",
		})
	);
}

function startDaemon(): Effect.Effect<null, TauriMcpFailure> {
	return fromPromise(
		() =>
			mkdtemp(join(tmpdir(), "acepe-qa-daemon-")).then(async (directory) => {
				const readyPath = join(directory, "ready.json");
				const socketPath = daemonSocketPath();
				if (existsSync(socketPath)) {
					rmSync(socketPath, { force: true });
				}
				const child = spawn(process.execPath, [daemonScriptPath(), socketPath, readyPath], {
					cwd: process.cwd(),
					detached: true,
					stdio: "ignore",
				});
				child.unref();
				await Effect.runPromise(waitForDaemon(readyPath));
				await readFile(readyPath, "utf8");
				return null;
			}),
		(error) => ({
			code: "qa_daemon_start_failed",
			message: error instanceof Error ? error.message : "Unable to start Acepe QA daemon.",
		})
	);
}

function ensureDaemon(): Effect.Effect<null, TauriMcpFailure> {
	return daemonRequest({ kind: "ping" }).pipe(
		Effect.map(() => null),
		Effect.catch(() => startDaemon())
	);
}

function commandFromDaemon(
	args: readonly string[]
): Effect.Effect<CommandExecution, TauriMcpFailure> {
	if (args[0] === "driver-session" && args[1] === "start") {
		const appIdentifier = valueAfter(args, "--port") ?? "9223";
		return ensureDaemon().pipe(
			Effect.flatMap(() => daemonRequest({ kind: "driver-session-start", appIdentifier })),
			Effect.map((response) => ({
				code: typeof response.code === "number" ? response.code : response.ok ? 0 : 1,
				stdout: response.stdout ?? "",
				stderr: response.stderr ?? "",
			}))
		);
	}

	if (args[0] === "webview-execute-js" || args[0] === "webview-execute-js-sync") {
		const appIdentifier = valueAfter(args, "--app-identifier") ?? "9223";
		const script = valueAfter(args, "--script") ?? "";
		const callTimeoutMs = Number.parseInt(valueAfter(args, "--call-timeout") ?? "", 10);
		const requestTimeoutMs =
			Number.isFinite(callTimeoutMs) && callTimeoutMs > 0
				? callTimeoutMs + 5_000
				: DAEMON_REQUEST_TIMEOUT_MS;
		const request =
			args[0] === "webview-execute-js-sync"
				? { kind: "webview-execute-js-sync", appIdentifier, script }
				: { kind: "webview-execute-js", appIdentifier, script, callTimeoutMs };
		return ensureDaemon().pipe(
			Effect.flatMap(() => daemonRequest(request, { timeoutMs: requestTimeoutMs })),
			Effect.flatMap((response) => {
				if (!response.ok) {
					return Effect.fail({
						code: "qa_daemon_webview_failed",
						message: response.message ?? "Acepe QA daemon WebView call failed.",
					});
				}
				return Effect.succeed({
					code: 0,
					stdout: JSON.stringify({
						text: response.text ?? "",
						content: [{ type: "text", text: response.text ?? "" }],
					}),
					stderr: "",
				});
			})
		);
	}

	if (args[0] === "webview-screenshot") {
		const appIdentifier = valueAfter(args, "--app-identifier") ?? "9223";
		return ensureDaemon().pipe(
			Effect.flatMap(() => daemonRequest({ kind: "webview-screenshot", appIdentifier })),
			Effect.flatMap((response) => {
				if (!response.ok) {
					return Effect.fail({
						code: "qa_daemon_screenshot_failed",
						message: response.message ?? "Acepe QA daemon screenshot failed.",
					});
				}
				return Effect.succeed({
					code: 0,
					stdout: JSON.stringify({
						text: response.text ?? "Screenshot captured",
						content: response.content ?? [],
						files: response.files ?? [],
					}),
					stderr: "",
				});
			})
		);
	}

	return Effect.fail({
		code: "qa_daemon_unsupported_command",
		message: args[0] ?? "empty command",
	});
}

function runTauriMcpCli(
	args: readonly string[],
	runner: CommandRunner = runCommand
): Effect.Effect<CommandExecution, TauriMcpFailure> {
	const command = ["npx", "-y", "-p", TAURI_MCP_CLI_VERSION, "tauri-mcp"].concat(Array.from(args));
	return runner(command);
}

export function runTauriMcp(
	args: readonly string[],
	runner: CommandRunner = runCommand
): Effect.Effect<CommandExecution, TauriMcpFailure> {
	if (runner !== runCommand) {
		return runTauriMcpCli(args, runner);
	}
	if (
		(args[0] === "driver-session" && args[1] === "start") ||
		args[0] === "webview-execute-js" ||
		args[0] === "webview-execute-js-sync" ||
		args[0] === "webview-screenshot"
	) {
		return commandFromDaemon(args);
	}
	return commandFromDaemon(args).pipe(Effect.catch(() => runTauriMcpCli(args, runner)));
}

const parseJsonObject = fromThrowable(
	(input: string) => JSON.parse(input) as object,
	(error) => {
		const message = error instanceof Error ? error.message : "JSON parse failed.";
		return {
			code: "json_parse_failed",
			message,
		};
	}
);

export function parseJsonText(text: string): Result.Result<object, TauriMcpFailure> {
	const parsed = Effect.runSync(Effect.result(parseJsonObject(text)));
	if (Result.isFailure(parsed)) {
		return Result.fail({
			code: parsed.failure.code,
			message: parsed.failure.message,
			raw: text.slice(0, 1_000),
		});
	}
	return Result.succeed(parsed.success);
}

export function unwrapTauriText(stdout: string): Result.Result<string, TauriMcpFailure> {
	return parseJsonText(stdout).pipe(
		Result.andThen((parsed) => {
			const parsedWrapper = decodeTauriTextWrapper(parsed);
			if (Result.isFailure(parsedWrapper)) {
				return Result.fail(
					schemaFailure("tauri_wrapper_parse_failed", parsedWrapper.failure, stdout.slice(0, 1_000))
				);
			}
			const firstContent = parsedWrapper.success.content?.find(
				(item) => item.text !== undefined
			)?.text;
			return Result.succeed(firstContent ?? parsedWrapper.success.text ?? stdout);
		})
	);
}

export function jsonObjectPrefix(text: string): string | null {
	const start = text.indexOf("{");
	if (start < 0) {
		return null;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = inString;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) {
			continue;
		}
		if (char === "{") {
			depth += 1;
		}
		if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return text.slice(start, index + 1);
			}
		}
	}
	return null;
}

function executeWebviewJsonCommand<S extends Schema.ConstraintDecoder<unknown>>(
	input: {
		readonly appIdentifier: string;
		readonly script: string;
		readonly schema: S;
		readonly callTimeoutMs?: number;
	},
	runner: CommandRunner,
	commandName: "webview-execute-js" | "webview-execute-js-sync"
): Effect.Effect<S["Type"], TauriMcpFailure> {
	const callTimeoutMs = input.callTimeoutMs ?? 15_000;
	const decodePayload = decodeUnknown(input.schema, (error) => ({
		code: "tauri_payload_schema_failed",
		message: error.message,
	}));

	const execute = (): Effect.Effect<S["Type"], TauriMcpFailure> =>
		runTauriMcp(
			[
				commandName,
				"--app-identifier",
				input.appIdentifier,
				"--json",
				"--call-timeout",
				callTimeoutMs.toString(),
				"--script",
				input.script,
			],
			runner
		).pipe(
			Effect.flatMap((execution) => {
				if (execution.code !== 0) {
					return Effect.fail({
						code: "tauri_mcp_failed",
						message:
							execution.stderr.trim() || execution.stdout.trim() || "Tauri MCP command failed.",
					});
				}
				return unwrapTauriText(execution.stdout).pipe(
					Result.andThen((text) => {
						const jsonText = jsonObjectPrefix(text);
						if (jsonText === null) {
							return Result.fail({
								code: "tauri_payload_not_json",
								message: `Tauri MCP did not return a JSON payload. Raw: ${text.slice(0, 500)}`,
								raw: text.slice(0, 1_000),
							});
						}
						return parseJsonText(jsonText);
					}),
					Result.andThen((json) => decodePayload(json)),
					(parsed) =>
						Result.isSuccess(parsed) ? Effect.succeed(parsed.success) : Effect.fail(parsed.failure)
				);
			})
		);

	return execute().pipe(
		Effect.catch((failure) => {
			if (!isNoActiveDriverSessionFailure(failure)) {
				return Effect.fail(failure);
			}
			return startDriverSession(input.appIdentifier, runner).pipe(
				Effect.flatMap((session) => {
					if (session.code !== 0) {
						return Effect.fail({
							code: "driver_session_failed",
							message:
								session.stderr.trim() ||
								session.stdout.trim() ||
								"Unable to start Tauri driver session.",
						});
					}
					return execute();
				})
			);
		})
	);
}

export function executeWebviewJson<S extends Schema.ConstraintDecoder<unknown>>(
	input: {
		readonly appIdentifier: string;
		readonly script: string;
		readonly schema: S;
		readonly callTimeoutMs?: number;
	},
	runner: CommandRunner = runCommand
): Effect.Effect<S["Type"], TauriMcpFailure> {
	return executeWebviewJsonCommand(input, runner, "webview-execute-js");
}

export function executeWebviewJsonSync<S extends Schema.ConstraintDecoder<unknown>>(
	input: {
		readonly appIdentifier: string;
		readonly script: string;
		readonly schema: S;
		readonly callTimeoutMs?: number;
	},
	runner: CommandRunner = runCommand
): Effect.Effect<S["Type"], TauriMcpFailure> {
	return executeWebviewJsonCommand(input, runner, "webview-execute-js-sync");
}

function isNoActiveDriverSessionFailure(failure: TauriMcpFailure): boolean {
	return (
		failure.message.includes("No active session") ||
		failure.raw?.includes("No active session") === true
	);
}

export function startDriverSession(
	appIdentifier: string,
	runner: CommandRunner = runCommand
): Effect.Effect<CommandExecution, TauriMcpFailure> {
	return runTauriMcp(["driver-session", "start", "--port", appIdentifier], runner);
}

export function captureWebviewScreenshot(
	appIdentifier: string,
	runner: CommandRunner = runCommand
): Effect.Effect<string, TauriMcpFailure> {
	return runTauriMcp(
		["webview-screenshot", "--app-identifier", appIdentifier, "--json"],
		runner
	).pipe(
		Effect.flatMap((execution) => {
			if (execution.code !== 0) {
				return Effect.fail({
					code: "screenshot_failed",
					message:
						execution.stderr.trim() || execution.stdout.trim() || "Screenshot command failed.",
				});
			}
			return parseJsonText(execution.stdout).pipe(
				Result.andThen((json) => decodeTauriScreenshotWrapper(json)),
				Result.andThen((wrapper) => {
					const filePath = wrapper.files?.[0]?.path;
					if (filePath !== undefined) {
						return Result.succeed(filePath);
					}
					const imageContentPath = wrapper.content?.find(
						(item) => item.type === "image" && item.path !== undefined
					)?.path;
					if (imageContentPath !== undefined) {
						return Result.succeed(imageContentPath);
					}
					if (wrapper.text !== undefined) {
						return Result.succeed(wrapper.text);
					}
					return Result.fail({
						code: "screenshot_path_missing",
						message: "Screenshot succeeded but did not include an image path.",
					});
				}),
				(parsed) =>
					Result.isSuccess(parsed) ? Effect.succeed(parsed.success) : Effect.fail(parsed.failure)
			);
		})
	);
}
