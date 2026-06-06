import { describe, expect, it } from "bun:test";
import { buildResult, formatCommandResult, statusExitCode } from "../output";

describe("acepe-qa output", () => {
	it("formats compact text with artifact path", () => {
		const result = buildResult({
			command: "doctor",
			status: "ok",
			summary: ["dev processes: 1", "bridge ok on 9223"],
			artifactPath: "/tmp/acepe-qa-doctor-1.json",
			artifactKind: "doctor",
		});

		expect(formatCommandResult(result, "text")).toBe(
			"doctor: ok\n- dev processes: 1\n- bridge ok on 9223\n- artifact: /tmp/acepe-qa-doctor-1.json\n"
		);
		expect(statusExitCode(result.status)).toBe(0);
	});

	it("formats machine-readable json", () => {
		const result = buildResult({
			command: "observe",
			status: "warn",
			summary: ["visible errors: 1"],
		});

		const parsed = JSON.parse(formatCommandResult(result, "json")) as {
			readonly command: string;
			readonly status: string;
			readonly summary: readonly string[];
		};
		expect(parsed.command).toBe("observe");
		expect(parsed.status).toBe("warn");
		expect(parsed.summary).toEqual(["visible errors: 1"]);
		expect(statusExitCode(result.status)).toBe(0);
	});

	it("prints structured errors without stacks", () => {
		const result = buildResult({
			command: "doctor",
			status: "fail",
			summary: ["Unable to inspect the Acepe dev target."],
			error: {
				code: "process_list_failed",
				message: "ps failed",
				nextStep: "Start the dev app.",
			},
		});

		expect(formatCommandResult(result, "text")).toBe(
			"doctor: fail\n- Unable to inspect the Acepe dev target.\n- error: process_list_failed: ps failed\n- next: Start the dev app.\n"
		);
		expect(statusExitCode(result.status)).toBe(1);
	});
});
