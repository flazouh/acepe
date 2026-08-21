import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { moveNativePointer } from "../native-pointer";
import type { CommandRunner } from "../tauri-mcp";

describe("native macOS pointer helper", () => {
	it("runs the pinned Swift helper with the requested screen point", async () => {
		let executedCommand: readonly string[] = [];
		const runner: CommandRunner = (command) => {
			executedCommand = command;
			return Effect.succeed({ code: 0, stdout: "", stderr: "" });
		};

		const result = await Effect.runPromise(
			Effect.result(moveNativePointer({ x: 410.5, y: 260.25 }, runner))
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(executedCommand[0]).toBe("/usr/bin/swift");
		expect(executedCommand[1]?.endsWith("/scripts/acepe-qa/native-pointer.swift")).toBe(true);
		expect(executedCommand.slice(2)).toEqual(["410.5", "260.25"]);
	});

	it("returns the native helper error when pointer movement fails", async () => {
		const runner: CommandRunner = () =>
			Effect.succeed({ code: 1, stdout: "", stderr: "CoreGraphics denied the event." });

		const result = await Effect.runPromise(
			Effect.result(moveNativePointer({ x: 20, y: 30 }, runner))
		);

		expect(Result.isFailure(result)).toBe(true);
		expect(Result.getOrThrow(Result.flip(result)).code).toBe("native_pointer_move_failed");
		expect(Result.getOrThrow(Result.flip(result)).message).toBe("CoreGraphics denied the event.");
	});
});
