import { describe, expect, it } from "bun:test";
import { parseOptions } from "../cli";

describe("acepe-qa cli options", () => {
	it("keeps hover sampling at 350ms unless --delay overrides it", () => {
		expect(parseOptions(["hover", "--selector=button"], "/repo").delayMs).toBe(350);
		expect(parseOptions(["hover", "--selector=button", "--delay=100"], "/repo").delayMs).toBe(
			100
		);
	});

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

	it("parses selector index for multi-panel scroller probes", () => {
		const options = parseOptions(["agent-panel-row-scan", "--selector-index=3"], "/repo");

		expect(options.selectorIndex).toBe(3);
	});

	it("parses stable panel and session identity for scoped sends", () => {
		const options = parseOptions(
			["send", "--panel-id=panel-f38", "--session-id=session-f38", "--text=QA prompt"],
			"/repo"
		);

		expect(options.panelId).toBe("panel-f38");
		expect(options.sessionId).toBe("session-f38");
	});

	it("parses stable panel and project path identity for project selection", () => {
		const options = parseOptions(
			[
				"select-project",
				"--panel-id=panel-acepe",
				"--project-path=/repo/acepe",
			],
			"/repo"
		);

		expect(options.command).toBe("select-project");
		expect(options.panelId).toBe("panel-acepe");
		expect(options.projectPath).toBe("/repo/acepe");
	});

	it("parses an optional first-send pre-scroll offset", () => {
		const options = parseOptions(
			["first-send-probe", "--pre-scroll-offset-px=2000"],
			"/repo"
		);

		expect(options.preScrollOffsetPx).toBe(2_000);
		expect(parseOptions(["first-send-probe"], "/repo").preScrollOffsetPx).toBeNull();
	});

	it("parses the provider-free send attach probe inputs", () => {
		const options = parseOptions(
			["send-attach-stress-probe", "--rows=120", "--pre-scroll-offset-px=2000"],
			"/repo"
		);

		expect(options.command).toBe("send-attach-stress-probe");
		expect(options.rows).toBe(120);
		expect(options.preScrollOffsetPx).toBe(2_000);
	});

	it("parses the provider-free planning-between-tools probe command", () => {
		const options = parseOptions(["planning-between-tools-probe"], "/repo");

		expect(options.command).toBe("planning-between-tools-probe");
	});

	it("parses a second click target for popover workflows", () => {
		const options = parseOptions(
			["click", "--selector=button[aria-label='Dev Tools']", "--then-text=Design System"],
			"/repo"
		);

		expect(options.thenSelector).toBe("");
		expect(options.thenText).toBe("Design System");
	});

	it("parses a selector as the second click target", () => {
		const options = parseOptions(
			["click", "--text=Open menu", "--then-selector=[role='menuitem']"],
			"/repo"
		);

		expect(options.thenSelector).toBe("[role='menuitem']");
		expect(options.thenText).toBe("");
	});
});
