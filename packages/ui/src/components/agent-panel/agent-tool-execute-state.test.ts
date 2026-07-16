import { describe, expect, test } from "bun:test";
import {
	extractExecuteCommandFilePath,
	getExecuteCommandSegments,
	getExecuteDisplayHtmls,
	getExecuteHeaderText,
	getExecuteStderrColor,
	getFallbackCommandHtmls,
	hasExecuteOutput,
	isExecuteError,
	isExecutePending,
	isExecuteSuccess,
	resolveExecuteCommandHtmls,
	resolveExecuteOutputHtml,
	shouldUseCommandHtmls,
	shouldUseOutputHtml,
} from "./agent-tool-execute-state.js";

const baseLabels = {
	runningLabel: "Executing...",
	finishedLabel: "Executed",
};

describe("agent tool execute state", () => {
	test("detects pending, success, and error states", () => {
		expect(isExecutePending("pending")).toBe(true);
		expect(isExecutePending("running")).toBe(true);
		expect(isExecutePending("done")).toBe(false);
		expect(isExecuteSuccess(0)).toBe(true);
		expect(isExecuteSuccess(1)).toBe(false);
		expect(isExecuteError(1)).toBe(true);
		expect(isExecuteError(undefined)).toBe(false);
	});

	test("detects output from plain text or highlighted html", () => {
		expect(hasExecuteOutput({ stdout: "ok" })).toBe(true);
		expect(hasExecuteOutput({ stderrHtml: "<span>err</span>" })).toBe(true);
		expect(hasExecuteOutput({ stdout: "", stderr: null })).toBe(false);
	});

	test("chooses header text from status", () => {
		expect(
			getExecuteHeaderText({
				status: "running",
				...baseLabels,
			})
		).toBe("Executing...");
		expect(
			getExecuteHeaderText({
				status: "blocked",
				...baseLabels,
			})
		).toBe("Waiting for permission");
		expect(
			getExecuteHeaderText({
				status: "error",
				...baseLabels,
			})
		).toBe("Command failed");
		expect(
			getExecuteHeaderText({
				status: "done",
				...baseLabels,
			})
		).toBe("Executed");
	});

	test("builds command display html from command or provider html", () => {
		const segments = getExecuteCommandSegments("echo hi && pwd");
		const fallbackHtmls = getFallbackCommandHtmls(segments);

		expect(segments.length).toBeGreaterThan(0);
		expect(fallbackHtmls.length).toBe(segments.length);
		expect(shouldUseCommandHtmls(undefined)).toBe(false);
		expect(shouldUseCommandHtmls([])).toBe(false);
		expect(shouldUseCommandHtmls(["<span>cmd</span>"])).toBe(true);
		expect(
			getExecuteDisplayHtmls({
				commandHtmls: ["<span>cmd</span>"],
				fallbackHtmls,
			})
		).toEqual(["<span>cmd</span>"]);
		expect(getExecuteDisplayHtmls({ fallbackHtmls })).toBe(fallbackHtmls);
	});

	test("chooses stderr color class by exit code", () => {
		expect(getExecuteStderrColor(0)).toBe("execute-stderr-warn");
		expect(getExecuteStderrColor(undefined)).toBe("execute-stderr-warn");
		expect(getExecuteStderrColor(2)).toBe("execute-stderr-err");
	});

	test("uses output html when provider sends a string", () => {
		expect(shouldUseOutputHtml("<span>ok</span>")).toBe(true);
		expect(shouldUseOutputHtml("")).toBe(true);
		expect(shouldUseOutputHtml(null)).toBe(false);
		expect(shouldUseOutputHtml(undefined)).toBe(false);
	});

	test("extracts trailing file paths from execute commands for compact chips", () => {
		expect(
			extractExecuteCommandFilePath(
				"bun test src/components/agent-panel/agent-tool-compact-display-state.test.ts"
			)
		).toBe("src/components/agent-panel/agent-tool-compact-display-state.test.ts");
		expect(extractExecuteCommandFilePath("cargo check -p acepe-desktop")).toBeNull();
		expect(extractExecuteCommandFilePath("cd packages/ui && bun run check")).toBeNull();
	});

	test("resolves command html via highlight callback once ready (survives ready-race)", () => {
		let ready = false;
		const highlightCommand = (code: string): string | null => {
			if (!ready) return null;
			return `<span style="color: var(--shiki-light)">${code}</span>`;
		};

		expect(
			resolveExecuteCommandHtmls({
				command: "echo hi && pwd",
				highlightCommand,
			})
		).toBeUndefined();

		ready = true;
		expect(
			resolveExecuteCommandHtmls({
				command: "echo hi && pwd",
				highlightCommand,
			})
		).toEqual([
			'<span style="color: var(--shiki-light)">echo hi</span>',
			'<span style="color: var(--shiki-light)">pwd</span>',
		]);
	});

	test("keeps precomputed commandHtmls over the highlight callback", () => {
		expect(
			resolveExecuteCommandHtmls({
				command: "echo hi",
				commandHtmls: ["<span>baked</span>"],
				highlightCommand: () => "<span>live</span>",
			})
		).toEqual(["<span>baked</span>"]);
	});

	test("resolves stdout/stderr html via highlightOutput when ready", () => {
		let ready = false;
		const highlight = (code: string): string | null => {
			if (!ready) return null;
			return `<span class="line">${code}</span>`;
		};

		expect(resolveExecuteOutputHtml({ text: "ok", highlight })).toBeNull();
		ready = true;
		expect(resolveExecuteOutputHtml({ text: "ok", highlight })).toBe(
			'<span class="line">ok</span>'
		);
		expect(
			resolveExecuteOutputHtml({
				text: "ok",
				precomputed: "<span>pre</span>",
				highlight,
			})
		).toBe("<span>pre</span>");
	});

	test("skips highlighting when the callback returns null for capped content", () => {
		const highlightCommand = (): string | null => null;
		expect(
			resolveExecuteCommandHtmls({
				command: "echo hi",
				highlightCommand,
			})
		).toBeUndefined();
		expect(
			resolveExecuteOutputHtml({
				text: "x".repeat(30_000),
				highlight: () => null,
			})
		).toBeNull();
	});
});
