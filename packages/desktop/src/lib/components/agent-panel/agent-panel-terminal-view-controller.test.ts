import { describe, expect, it } from "bun:test";
import { SessionId, TerminalId } from "@acepe/contracts";

import { TerminalViewController } from "./agent-panel-terminal-view-controller.svelte.ts";

const projectedTerminal = (overrides: { output: string; closed?: boolean }) => ({
	sequence: 1,
	terminalId: TerminalId.make("term-1"),
	sessionId: SessionId.make("session-1"),
	cwd: "/tmp",
	cols: 80,
	rows: 24,
	closed: overrides.closed ?? false,
	output: overrides.output,
});

describe("TerminalViewController input buffering (defect 1: input race)", () => {
	it("buffers keystrokes submitted before the terminal is marked open", () => {
		const controller = new TerminalViewController();

		const dispatchedImmediately = controller.submitInput("echo QA_TERMINAL_42");

		expect(dispatchedImmediately).toEqual([]);
	});

	it("flushes buffered keystrokes in order once the terminal opens, then dispatches directly", () => {
		const controller = new TerminalViewController();

		controller.submitInput("echo QA_TERMINAL_42");
		controller.submitInput("\r");

		const flushed = controller.markOpenReady();
		expect(flushed).toEqual(["echo QA_TERMINAL_42", "\r"]);

		// Buffer must be drained: a second flush yields nothing.
		expect(controller.markOpenReady()).toEqual([]);

		// After open, new input dispatches immediately (no more buffering).
		expect(controller.submitInput("ls\n")).toEqual(["ls\n"]);
	});
});

describe("TerminalViewController.reportError / markInputSucceeded (defect 3: stale error)", () => {
	it("clears lastError once a subsequent input dispatch succeeds", () => {
		const controller = new TerminalViewController();

		controller.reportError(new Error("RpcTransportError: RPC request timed out"));
		expect(controller.lastError).not.toBeNull();

		controller.markInputSucceeded();

		expect(controller.lastError).toBeNull();
	});

	it("clears lastError on the next successful poll tick (applySnapshot)", () => {
		const controller = new TerminalViewController();

		controller.reportError(new Error("RpcTransportError: RPC request timed out"));
		expect(controller.lastError).not.toBeNull();

		controller.applySnapshot(projectedTerminal({ output: "QA_TERMINAL_42\n" }));

		expect(controller.lastError).toBeNull();
	});
});

describe("TerminalViewController.applySnapshot", () => {
	it("returns a delta instruction for output growth", () => {
		const controller = new TerminalViewController();
		expect(controller.applySnapshot(projectedTerminal({ output: "abc" }))).toEqual({
			kind: "delta",
			text: "abc",
		});
		expect(controller.applySnapshot(projectedTerminal({ output: "abcdef" }))).toEqual({
			kind: "delta",
			text: "def",
		});
	});

	it("returns a reset instruction when output shrinks (ring buffer dropped the front)", () => {
		const controller = new TerminalViewController();
		controller.applySnapshot(projectedTerminal({ output: "0123456789" }));
		const instruction = controller.applySnapshot(projectedTerminal({ output: "56789" }));
		expect(instruction).toEqual({ kind: "reset", text: "56789" });
	});

	it("returns null for a no-op snapshot", () => {
		const controller = new TerminalViewController();
		controller.applySnapshot(projectedTerminal({ output: "abc" }));
		expect(controller.applySnapshot(projectedTerminal({ output: "abc" }))).toBeNull();
	});
});
