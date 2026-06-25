import { describe, expect, it } from "bun:test";
import { ok } from "neverthrow";
import { parseProcessList, runDoctor } from "../process-target";
import type { CommandExecution } from "../tauri-mcp";

const checkoutRoot = "/Users/alex/Documents/acepe";

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
				return ok({
					code: 0,
					stdout: "101 /Users/alex/Documents/acepe/packages/desktop/src-tauri/target/debug/acepe\n",
					stderr: "",
				} satisfies CommandExecution).asyncAndThen((execution) => ok(execution));
			}

			const appIdentifierIndex = command.indexOf("--app-identifier");
			const appIdentifier = appIdentifierIndex >= 0 ? command[appIdentifierIndex + 1] : "";
			if (appIdentifier === "9224") {
				return ok({
					code: 0,
					stdout: JSON.stringify({ url: "http://localhost:1420/", title: "Acepe" }),
					stderr: "",
				} satisfies CommandExecution).asyncAndThen((execution) => ok(execution));
			}

			return ok({
				code: 1,
				stdout: "",
				stderr: "No active session.",
			} satisfies CommandExecution).asyncAndThen((execution) => ok(execution));
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
});
