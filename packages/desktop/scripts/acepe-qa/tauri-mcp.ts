import { Result, ResultAsync, err, ok } from "neverthrow";
import { z } from "zod";

const TAURI_MCP_CLI_VERSION = "@hypothesi/tauri-mcp-cli@0.10.0";

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

export function runTauriMcp(
	args: readonly string[],
	runner: CommandRunner = runCommand
): ResultAsync<CommandExecution, TauriMcpFailure> {
	const command = ["npx", "-y", "-p", TAURI_MCP_CLI_VERSION, "tauri-mcp"].concat(Array.from(args));
	return runner(command);
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
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
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
						message: "Tauri MCP did not return a JSON payload.",
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
