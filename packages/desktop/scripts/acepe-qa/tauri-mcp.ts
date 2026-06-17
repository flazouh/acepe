import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import { Result, ResultAsync, err, ok } from "neverthrow";
import { z } from "zod";

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

export type CommandRunner = (command: readonly string[]) => ResultAsync<CommandExecution, TauriMcpFailure>;

const tauriTextWrapperSchema = z.object({
	content: z.array(z.object({ text: z.string().optional() })).optional(),
	text: z.string().optional(),
});

const tauriScreenshotWrapperSchema = z.object({
	files: z.array(z.object({ path: z.string() })).optional(),
	content: z
		.array(
			z.object({
				type: z.string().optional(),
				path: z.string().optional(),
				text: z.string().optional(),
			})
		)
		.optional(),
	text: z.string().optional(),
});

const daemonResponseSchema = z.object({
	ok: z.boolean(),
	code: z.number().optional(),
	stdout: z.string().optional(),
	stderr: z.string().optional(),
	text: z.string().optional(),
	content: z.array(z.object({ type: z.string().optional(), text: z.string().optional(), path: z.string().optional(), data: z.string().optional(), mimeType: z.string().optional() })).optional(),
	files: z.array(z.object({ path: z.string(), mimeType: z.string().optional() })).optional(),
	message: z.string().optional(),
});

export function runCommand(command: readonly string[]): ResultAsync<CommandExecution, TauriMcpFailure> {
	return ResultAsync.fromPromise(
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

function daemonRequest(
	payload: object,
	options?: { readonly timeoutMs?: number }
): ResultAsync<z.infer<typeof daemonResponseSchema>, TauriMcpFailure> {
	return ResultAsync.fromPromise(
		new Promise<z.infer<typeof daemonResponseSchema>>((resolve, reject) => {
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
				const parsed = Result.fromThrowable(
					(input: string) => JSON.parse(input) as object,
					(error) => new Error(error instanceof Error ? error.message : "Daemon JSON parse failed.")
				)(raw);
				if (parsed.isErr()) {
					reject(parsed.error);
					return;
				}
				const response = daemonResponseSchema.safeParse(parsed.value);
				if (!response.success) {
					reject(new Error(response.error.message));
					return;
				}
				resolve(response.data);
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

function waitForDaemon(readyPath: string): ResultAsync<null, TauriMcpFailure> {
	return ResultAsync.fromPromise(
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

function startDaemon(): ResultAsync<null, TauriMcpFailure> {
	return ResultAsync.fromPromise(
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
			await waitForDaemon(readyPath).match(
				() => undefined,
				(error) => {
					throw new Error(error.message);
				}
			);
			await readFile(readyPath, "utf8");
			return null;
		}),
		(error) => ({
			code: "qa_daemon_start_failed",
			message: error instanceof Error ? error.message : "Unable to start Acepe QA daemon.",
		})
	);
}

function ensureDaemon(): ResultAsync<null, TauriMcpFailure> {
	return daemonRequest({ kind: "ping" })
		.map(() => null)
		.orElse(() => startDaemon());
}

function commandFromDaemon(args: readonly string[]): ResultAsync<CommandExecution, TauriMcpFailure> {
	if (args[0] === "driver-session" && args[1] === "start") {
		const appIdentifier = valueAfter(args, "--port") ?? "9223";
		return ensureDaemon()
			.andThen(() => daemonRequest({ kind: "driver-session-start", appIdentifier }))
			.map((response) => ({
				code: response.code ?? 0,
				stdout: response.stdout ?? "",
				stderr: response.stderr ?? "",
			}));
	}

	if (args[0] === "webview-execute-js") {
		const appIdentifier = valueAfter(args, "--app-identifier") ?? "9223";
		const script = valueAfter(args, "--script") ?? "";
		const callTimeoutMs = Number.parseInt(valueAfter(args, "--call-timeout") ?? "", 10);
		const requestTimeoutMs =
			Number.isFinite(callTimeoutMs) && callTimeoutMs > 0
				? callTimeoutMs + 5_000
				: DAEMON_REQUEST_TIMEOUT_MS;
		return ensureDaemon()
			.andThen(() =>
				daemonRequest(
					{ kind: "webview-execute-js", appIdentifier, script },
					{ timeoutMs: requestTimeoutMs }
				)
			)
			.andThen((response) => {
				if (!response.ok) {
					return err({
						code: "qa_daemon_webview_failed",
						message: response.message ?? "Acepe QA daemon WebView call failed.",
					});
				}
				return ok({
					code: 0,
					stdout: JSON.stringify({
						text: response.text ?? "",
						content: [{ type: "text", text: response.text ?? "" }],
					}),
					stderr: "",
				});
			});
	}

	if (args[0] === "webview-screenshot") {
		const appIdentifier = valueAfter(args, "--app-identifier") ?? "9223";
		return ensureDaemon()
			.andThen(() => daemonRequest({ kind: "webview-screenshot", appIdentifier }))
			.andThen((response) => {
				if (!response.ok) {
					return err({
						code: "qa_daemon_screenshot_failed",
						message: response.message ?? "Acepe QA daemon screenshot failed.",
					});
				}
				return ok({
					code: 0,
					stdout: JSON.stringify({
						text: response.text ?? "Screenshot captured",
						content: response.content ?? [],
						files: response.files ?? [],
					}),
					stderr: "",
				});
			});
	}

	return err({
		code: "qa_daemon_unsupported_command",
		message: args[0] ?? "empty command",
	});
}

function runTauriMcpCli(
	args: readonly string[],
	runner: CommandRunner = runCommand
): ResultAsync<CommandExecution, TauriMcpFailure> {
	const command = ["npx", "-y", "-p", TAURI_MCP_CLI_VERSION, "tauri-mcp"].concat(Array.from(args));
	return runner(command);
}

export function runTauriMcp(
	args: readonly string[],
	runner: CommandRunner = runCommand
): ResultAsync<CommandExecution, TauriMcpFailure> {
	if (runner !== runCommand) {
		return runTauriMcpCli(args, runner);
	}
	return commandFromDaemon(args).orElse(() => runTauriMcpCli(args, runner));
}

export function parseJsonText(text: string): Result<object, TauriMcpFailure> {
	const parse = Result.fromThrowable(
		(input: string) => JSON.parse(input) as object,
		(error) => {
			const message = error instanceof Error ? error.message : "JSON parse failed.";
			return {
				code: "json_parse_failed",
				message,
				raw: text.slice(0, 1_000),
			};
		}
	);
	return parse(text);
}

export function unwrapTauriText(stdout: string): Result<string, TauriMcpFailure> {
	return parseJsonText(stdout).andThen((parsed) => {
		const parsedWrapper = tauriTextWrapperSchema.safeParse(parsed);
		if (!parsedWrapper.success) {
			return err({
				code: "tauri_wrapper_parse_failed",
				message: parsedWrapper.error.message,
				raw: stdout.slice(0, 1_000),
			});
		}
		const firstContent = parsedWrapper.data.content?.find((item) => item.text !== undefined)?.text;
		return ok(firstContent ?? parsedWrapper.data.text ?? stdout);
	});
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
		if (char === "\"") {
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

export function executeWebviewJson<T>(
	input: {
		readonly appIdentifier: string;
		readonly script: string;
		readonly schema: z.ZodType<T>;
		readonly callTimeoutMs?: number;
	},
	runner: CommandRunner = runCommand
): ResultAsync<T, TauriMcpFailure> {
	const callTimeoutMs = input.callTimeoutMs ?? 15_000;
	return runTauriMcp(
		[
			"webview-execute-js",
			"--app-identifier",
			input.appIdentifier,
			"--json",
			"--call-timeout",
			callTimeoutMs.toString(),
			"--script",
			input.script,
		],
		runner
	).andThen((execution) => {
		if (execution.code !== 0) {
			return err({
				code: "tauri_mcp_failed",
				message: execution.stderr.trim() || execution.stdout.trim() || "Tauri MCP command failed.",
			});
		}
		return unwrapTauriText(execution.stdout)
			.andThen((text) => {
				const jsonText = jsonObjectPrefix(text);
				if (jsonText === null) {
					return err({
						code: "tauri_payload_not_json",
						message: `Tauri MCP did not return a JSON payload. Raw: ${text.slice(0, 500)}`,
						raw: text.slice(0, 1_000),
					});
				}
				return parseJsonText(jsonText);
			})
			.andThen((json) => {
				const parsed = input.schema.safeParse(json);
				if (!parsed.success) {
					return err({
						code: "tauri_payload_schema_failed",
						message: parsed.error.message,
					});
				}
				return ok(parsed.data);
			});
	});
}

export function startDriverSession(
	appIdentifier: string,
	runner: CommandRunner = runCommand
): ResultAsync<CommandExecution, TauriMcpFailure> {
	return runTauriMcp(["driver-session", "start", "--port", appIdentifier], runner);
}

export function captureWebviewScreenshot(
	appIdentifier: string,
	runner: CommandRunner = runCommand
): ResultAsync<string, TauriMcpFailure> {
	return runTauriMcp(
		["webview-screenshot", "--app-identifier", appIdentifier, "--json"],
		runner
	).andThen((execution) => {
		if (execution.code !== 0) {
			return err({
				code: "screenshot_failed",
				message: execution.stderr.trim() || execution.stdout.trim() || "Screenshot command failed.",
			});
		}
		return parseJsonText(execution.stdout).andThen((json) => {
			const wrapper = tauriScreenshotWrapperSchema.safeParse(json);
			if (!wrapper.success) {
				return err({
					code: "screenshot_payload_schema_failed",
					message: wrapper.error.message,
				});
			}
			const filePath = wrapper.data.files?.[0]?.path;
			if (filePath !== undefined) {
				return ok(filePath);
			}
			const imageContentPath = wrapper.data.content?.find((item) => item.type === "image" && item.path !== undefined)?.path;
			if (imageContentPath !== undefined) {
				return ok(imageContentPath);
			}
			if (wrapper.data.text !== undefined) {
				return ok(wrapper.data.text);
			}
			return err({
				code: "screenshot_path_missing",
				message: "Screenshot succeeded but did not include an image path.",
			});
		});
	});
}
