import { describe, expect, it } from "bun:test";
import { ok } from "neverthrow";
import { parseProcessList, runDoctor } from "../process-target";
import type { CommandExecution } from "../tauri-mcp";

const checkoutRoot = "/Users/alex/Documents/acepe";

function okExecution(execution: CommandExecution) {
	return ok(execution).asyncAndThen((value) => ok(value));
}

describe("acepe-qa process target parsing", () => {
	it("detects dev and production Acepe processes separately", () => {
		const processes = parseProcessList(
			[
				"101 /Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/acepe --port 9223",
				"202 /Applications/Acepe.app/Contents/MacOS/acepe",
				"303 /bin/zsh",
			].join("\n"),
			checkoutRoot
		);

		expect(processes).toEqual([
			{
				pid: 101,
				command:
					"/Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/acepe --port 9223",
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

	it("detects the debug app bundle as a dev process", () => {
		const processes = parseProcessList(
			[
				"156 /Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/bundle/macos/Acepe Dev QA.app/Contents/MacOS/acepe",
			].join("\n"),
			checkoutRoot
		);

		expect(processes).toEqual([
			{
				pid: 156,
				command:
					"/Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/bundle/macos/Acepe Dev QA.app/Contents/MacOS/acepe",
				kind: "dev",
			},
		]);
	});

	it("ignores malformed process lines", () => {
		const processes = parseProcessList(
			["bad line", "404 tauri dev", "     ", "nope"].join("\n"),
			checkoutRoot
		);

		expect(processes).toEqual([
			{
				pid: 404,
				command: "tauri dev",
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
					stdout: "101 /Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/acepe\n",
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

		const result = await runDoctor({
			checkoutRoot,
			runner,
		});

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.bridge).toEqual({
				port: "9224",
				available: true,
			});
		}
		expect(calls.some((call) => call.includes("--app-identifier 9223"))).toBe(true);
		expect(calls.some((call) => call.includes("--app-identifier 9224"))).toBe(true);
	});

	it("reports stale when any Rust source is newer than the dev binary", async () => {
		const runner = (command: readonly string[]) => {
			if (command[0] === "ps") {
				return okExecution({
					code: 0,
					stdout:
						"101 /Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/acepe --port 9223\n",
					stderr: "",
				});
			}

			if (command[0] === "find") {
				return okExecution({
					code: 0,
					stdout: "/Users/alex/Documents/acepe/packages/desktop/src-tauri/src/commands/window.rs\n",
					stderr: "",
				});
			}

			return okExecution({
				code: 0,
				stdout: JSON.stringify({ url: "http://localhost:1420/", title: "Acepe" }),
				stderr: "",
			});
		};

		const result = await runDoctor({
			checkoutRoot,
			runner,
		});

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.status).toBe("warn");
			expect(result.value.binaryFreshness).toEqual({
				status: "stale",
				message:
					"Rust source is newer than target/debug/acepe: packages/desktop/src-tauri/src/commands/window.rs",
			});
			expect(result.value.findings).toEqual([
				"Rust source is newer than target/debug/acepe: packages/desktop/src-tauri/src/commands/window.rs",
			]);
		}
	});

	it("reports fresh when no Rust source is newer than the dev binary", async () => {
		const runner = (command: readonly string[]) => {
			if (command[0] === "ps") {
				return okExecution({
					code: 0,
					stdout:
						"101 /Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/acepe --port 9223\n",
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

		const result = await runDoctor({
			checkoutRoot,
			runner,
		});

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.status).toBe("ok");
			expect(result.value.binaryFreshness).toEqual({
				status: "fresh",
				message: "target/debug/acepe is newer than all checked Rust sources.",
			});
			expect(result.value.findings).toEqual([]);
		}
	});

	it("reports stale when bundled frontend is older than frontend sources", async () => {
		const runner = (command: readonly string[]) => {
			const joined = command.join(" ");
			if (command[0] === "ps") {
				return okExecution({
					code: 0,
					stdout:
						"101 /Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/bundle/macos/Acepe Dev QA.app/Contents/MacOS/acepe --port 9223\n",
					stderr: "",
				});
			}

			if (command[0] === "find" && joined.includes("packages/desktop/src-tauri/src")) {
				return okExecution({
					code: 0,
					stdout: "",
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
				stdout: JSON.stringify({ url: "tauri://localhost/", title: "Acepe" }),
				stderr: "",
			});
		};

		const result = await runDoctor({
			checkoutRoot,
			runner,
		});

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.status).toBe("warn");
			expect(result.value.binaryFreshness.status).toBe("fresh");
			expect(result.value.frontendFreshness).toEqual({
				status: "stale",
				message:
					"Frontend source is newer than packages/desktop/build while WebView is not using Vite: packages/desktop/src/lib/acp/store/services/session-open-hydrator.ts",
			});
			expect(result.value.findings).toEqual([
				"Frontend source is newer than packages/desktop/build while WebView is not using Vite: packages/desktop/src/lib/acp/store/services/session-open-hydrator.ts",
			]);
		}
	});
});
