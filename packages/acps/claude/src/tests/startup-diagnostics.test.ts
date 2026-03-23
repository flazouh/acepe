import { describe, expect, it } from "vitest";

import {
	formatStartupFailureReport,
	markStartupFailureLogged,
	shouldLogStartupFailure,
} from "../startup-diagnostics.js";

describe("formatStartupFailureReport", () => {
	it("includes startup context and error details for Error objects", () => {
		const report = formatStartupFailureReport(
			{
				entrypoint: "static-entry",
				mode: "acp",
				stage: "load-acepe-acp",
				argv: ["/Applications/Acepe.app/claude-agent-acp"],
				cwd: "/Users/tester",
				execPath: "/Applications/Acepe.app/claude-agent-acp",
				platform: "darwin",
				arch: "arm64",
				runtimeVersion: "v20.0.0",
				bunVersion: "1.3.10",
				singleFileBun: true,
			},
			new Error("boom")
		);

		expect(report).toContain("[acepe-claude-startup]");
		expect(report).toContain("entrypoint=static-entry");
		expect(report).toContain("mode=acp");
		expect(report).toContain("stage=load-acepe-acp");
		expect(report).toContain('argv=["/Applications/Acepe.app/claude-agent-acp"]');
		expect(report).toContain("error=Error: boom");
	});

	it("formats non-Error failures without crashing", () => {
		const report = formatStartupFailureReport(
			{
				entrypoint: "index",
				mode: "cli",
				stage: "load-claude-cli",
				argv: ["--cli"],
				cwd: "/tmp",
				execPath: "/tmp/claude-agent-acp",
				platform: "linux",
				arch: "x64",
				runtimeVersion: "v20.0.0",
				bunVersion: undefined,
				singleFileBun: false,
			},
			"string failure"
		);

		expect(report).toContain("entrypoint=index");
		expect(report).toContain("mode=cli");
		expect(report).toContain("error=string failure");
	});
});

describe("startup failure dedupe", () => {
	it("marks object failures so they are only logged once", () => {
		const error = new Error("boom once");

		expect(shouldLogStartupFailure(error)).toBe(true);
		markStartupFailureLogged(error);
		expect(shouldLogStartupFailure(error)).toBe(false);
	});
});
