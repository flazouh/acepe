import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { parseProcessList, runDoctor } from "../process-target";
import type { CommandExecution } from "../tauri-mcp";

const checkoutRoot = "/Users/alex/Documents/acepe";

function okExecution(execution: CommandExecution) {
	return Effect.succeed(execution);
}

describe("acepe-qa process target parsing", () => {
	it("detects dev and production Acepe processes separately", () => {
		const processes = parseProcessList(
			[
				"101 /Users/alex/Documents/acepe/packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app/Contents/MacOS/launcher --port 9223",
				"202 /Applications/Acepe.app/Contents/MacOS/acepe",
				"303 /bin/zsh",
			].join("\n"),
			checkoutRoot
		);

		expect(processes).toEqual([
			{
				pid: 101,
				command:
					"/Users/alex/Documents/acepe/packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app/Contents/MacOS/launcher --port 9223",
				kind: "dev",
			},
			{
				pid: 202,
				command: "/Applications/Acepe.app/Contents/MacOS/acepe",
				kind: "production",
			},
			{
				pid: 303,
				command: "/bin/zsh",
				kind: "other",
			},
		]);
	});

	it("detects the Electrobun build command as a dev process", () => {
		const processes = parseProcessList(
			["156 bunx electrobun build --env=stable"].join("\n"),
			checkoutRoot
		);

		expect(processes).toEqual([
			{
				pid: 156,
				command: "bunx electrobun build --env=stable",
				kind: "dev",
			},
		]);
	});

	it("ignores malformed process lines", () => {
		const processes = parseProcessList(
			["bad line", "404 electrobun build", "     ", "nope"].join("\n"),
			checkoutRoot
		);

		expect(processes).toEqual([
			{
				pid: 404,
				command: "electrobun build",
				kind: "dev",
			},
		]);
	});

	it("falls back to the active bridge port when the default port is empty", async () => {
		const calls: string[] = [];
		const runner = (command: readonly string[]) => {
			calls.push(command.join(" "));
			if (command[0] === "ps") {
				return okExecution({
					code: 0,
					stdout:
						"101 /Users/alex/Documents/acepe/packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app/Contents/MacOS/launcher\n",
					stderr: "",
				});
			}

			if (command[0] === "find") {
				return okExecution({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}

			const appIdentifierIndex = command.indexOf("--app-identifier");
			const appIdentifier = appIdentifierIndex >= 0 ? command[appIdentifierIndex + 1] : "";
			if (appIdentifier === "9224") {
				return okExecution({
					code: 0,
					stdout: JSON.stringify({ url: "http://localhost:1420/", title: "Acepe" }),
					stderr: "",
				});
			}

			return okExecution({
				code: 1,
				stdout: "",
				stderr: "No active session.",
			});
		};

		const result = await Effect.runPromise(
			Effect.result(
				runDoctor({
					checkoutRoot,
					runner,
				})
			)
		);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success.bridge).toEqual({
				port: "9224",
				available: true,
			});
		}
		expect(calls.some((call) => call.includes("--app-identifier 9223"))).toBe(true);
		expect(calls.some((call) => call.includes("--app-identifier 9224"))).toBe(true);
	});

	it("reports no Rust binary for Electrobun freshness", async () => {
		const runner = (command: readonly string[]) => {
			if (command[0] === "ps") {
				return okExecution({
					code: 0,
					stdout:
						"101 /Users/alex/Documents/acepe/packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app/Contents/MacOS/launcher --port 9223\n",
					stderr: "",
				});
			}

			if (command[0] === "find") {
				return okExecution({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}

			return okExecution({
				code: 0,
				stdout: JSON.stringify({ url: "http://localhost:1420/", title: "Acepe" }),
				stderr: "",
			});
		};

		const result = await Effect.runPromise(
			Effect.result(
				runDoctor({
					checkoutRoot,
					runner,
				})
			)
		);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success.status).toBe("ok");
			expect(result.success.binaryFreshness).toEqual({
				status: "fresh",
				message: "Acepe ships with Electrobun and Bun. There is no Rust binary.",
			});
			expect(result.success.findings).toEqual([]);
		}
	});

	it("reports stale when bundled frontend is older than frontend sources", async () => {
		const runner = (command: readonly string[]) => {
			const joined = command.join(" ");
			if (command[0] === "ps") {
				return okExecution({
					code: 0,
					stdout:
						"101 /Users/alex/Documents/acepe/packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app/Contents/MacOS/launcher --port 9223\n",
					stderr: "",
				});
			}

			if (command[0] === "find" && joined.includes("packages/desktop/src")) {
				return okExecution({
					code: 0,
					stdout:
						"/Users/alex/Documents/acepe/packages/desktop/src/lib/acp/store/services/session-open-hydrator.ts\n",
					stderr: "",
				});
			}

			if (command[0] === "find" && joined.includes("packages/ui/src")) {
				return okExecution({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}

			return okExecution({
				code: 0,
				stdout: JSON.stringify({ url: "electrobun://localhost/", title: "Acepe" }),
				stderr: "",
			});
		};

		const result = await Effect.runPromise(
			Effect.result(
				runDoctor({
					checkoutRoot,
					runner,
				})
			)
		);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success.status).toBe("warn");
			expect(result.success.binaryFreshness.status).toBe("fresh");
			expect(result.success.frontendFreshness).toEqual({
				status: "stale",
				message:
					"Frontend source is newer than packages/desktop/build while WebView is not using Vite: packages/desktop/src/lib/acp/store/services/session-open-hydrator.ts",
			});
			expect(result.success.findings).toEqual([
				"Frontend source is newer than packages/desktop/build while WebView is not using Vite: packages/desktop/src/lib/acp/store/services/session-open-hydrator.ts",
			]);
		}
	});
});
