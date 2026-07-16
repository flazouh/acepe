import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import { moveNativePointer } from "../native-pointer";
import type { CommandRunner } from "../tauri-mcp";

describe("native macOS pointer helper", () => {
	it("runs the pinned Swift helper with the requested screen point", async () => {
		let executedCommand: readonly string[] = [];
		const runner: CommandRunner = (command) => {
			executedCommand = command;
			return okAsync({ code: 0, stdout: "", stderr: "" });
		};

		const result = await moveNativePointer({ x: 410.5, y: 260.25 }, runner);

		expect(result.isOk()).toBe(true);
		expect(executedCommand[0]).toBe("/usr/bin/swift");
		expect(executedCommand[1]?.endsWith("/scripts/acepe-qa/native-pointer.swift")).toBe(true);
		expect(executedCommand.slice(2)).toEqual(["410.5", "260.25"]);
	});

	it("returns the native helper error when pointer movement fails", async () => {
		const runner: CommandRunner = () =>
			okAsync({ code: 1, stdout: "", stderr: "CoreGraphics denied the event." });

		const result = await moveNativePointer({ x: 20, y: 30 }, runner);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().code).toBe("native_pointer_move_failed");
		expect(result._unsafeUnwrapErr().message).toBe("CoreGraphics denied the event.");
	});
});
