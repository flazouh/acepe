import { describe, expect, it } from "bun:test";
import { parseOptions } from "../cli";

describe("acepe-qa cli options", () => {
	it("parses scroll page settle timing independently from generic delay", () => {
		const options = parseOptions(
			["agent-panel-scroll-page-probe", "--settle-ms=16", "--delay=300"],
			"/repo"
		);

		expect(options.command).toBe("agent-panel-scroll-page-probe");
		expect(options.settleMs).toBe(16);
		expect(options.delayMs).toBe(300);
	});

	it("keeps delay as the settle fallback for older probe commands", () => {
		const options = parseOptions(["agent-panel-scroll-page-probe", "--delay=24"], "/repo");

		expect(options.settleMs).toBe(24);
		expect(options.delayMs).toBe(24);
	});
});
