import { describe, expect, it } from "bun:test";
import { parseProcessList } from "../process-target";

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
});
