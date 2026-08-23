import { SessionId, TerminalId } from "@acepe/contracts";
import { describe, expect, it } from "bun:test";

import {
	closeTerminalCommand,
	inputTerminalCommand,
	nextTerminalId,
	openTerminalCommand,
	resizeTerminalCommand,
} from "./agent-panel-terminal-store.ts";

describe("nextTerminalId", () => {
	it("mints distinct ids on successive calls", () => {
		const a = nextTerminalId();
		const b = nextTerminalId();
		expect(a).not.toBe(b);
	});
});

describe("openTerminalCommand", () => {
	it("carries the session, cwd, and default size", () => {
		const terminalId = TerminalId.make("term-1");
		const sessionId = SessionId.make("session-1");
		const command = openTerminalCommand({ terminalId, sessionId, cwd: "/tmp/project" });
		expect(command.type).toBe("terminal.open");
		expect(command.terminalId).toBe(terminalId);
		expect(command.sessionId).toBe(sessionId);
		expect(command.cwd).toBe("/tmp/project");
		expect(command.cols).toBe(80);
		expect(command.rows).toBe(24);
	});
});

describe("inputTerminalCommand", () => {
	it("builds a terminal.input command carrying the typed data", () => {
		const terminalId = TerminalId.make("term-1");
		const command = inputTerminalCommand(terminalId, "echo hi\n");
		expect(command?.type).toBe("terminal.input");
		expect(command?.data).toBe("echo hi\n");
	});

	it("returns null for empty input so no-op keystrokes skip a dispatch", () => {
		const terminalId = TerminalId.make("term-1");
		expect(inputTerminalCommand(terminalId, "")).toBeNull();
	});
});

describe("resizeTerminalCommand", () => {
	it("carries the requested cols/rows", () => {
		const terminalId = TerminalId.make("term-1");
		const command = resizeTerminalCommand(terminalId, 120, 40);
		expect(command.type).toBe("terminal.resize");
		expect(command.cols).toBe(120);
		expect(command.rows).toBe(40);
	});
});

describe("closeTerminalCommand", () => {
	it("carries only the terminal id", () => {
		const terminalId = TerminalId.make("term-1");
		const command = closeTerminalCommand(terminalId);
		expect(command.type).toBe("terminal.close");
		expect(command.terminalId).toBe(terminalId);
	});
});
