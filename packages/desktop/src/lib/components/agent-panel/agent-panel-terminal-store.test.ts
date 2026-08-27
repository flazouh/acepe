import { describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	type ProjectedTerminal,
	type RpcClient,
	RpcTransportError,
	SessionId,
	TerminalId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";

import {
	closeTerminalCommand,
	followTerminal,
	inputTerminalCommand,
	nextTerminalId,
	openTerminalCommand,
	resizeTerminalCommand,
} from "./agent-panel-terminal-store.ts";

const unusedProjectIndex = {
	projectPath: "/tmp/acepe",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const projectedTerminal = (output: string): ProjectedTerminal => ({
	sequence: 1,
	terminalId: TerminalId.make("term-1"),
	sessionId: SessionId.make("session-1"),
	cwd: "/tmp",
	cols: 80,
	rows: 24,
	closed: false,
	output,
});

/** A client whose `snapshot` fails `failureCount` times before succeeding. */
const fakeFlakyClient = (input: {
	readonly failureCount: number;
	readonly outputAfterRecovery: string;
}): { readonly client: RpcClient; readonly callCount: () => number } => {
	let calls = 0;
	const client: RpcClient = {
		dispatch: () => Effect.succeed({ sequence: 1 }),
		snapshot: () => {
			calls += 1;
			if (calls <= input.failureCount) {
				return Effect.fail(new RpcTransportError({ reason: "RPC request timed out" }));
			}
			return Effect.succeed({
				...emptyRpcSessionSnapshot(1),
				terminal: projectedTerminal(input.outputAfterRecovery),
			});
		},
		getProjectIndex: () => Effect.succeed(unusedProjectIndex),
		invalidateProjectIndex: () => Effect.void,
		readTextFile: () => Effect.succeed(""),
		writeTextFile: () => Effect.void,
		getDefaultShell: () => Effect.succeed("/bin/zsh"),
		gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
		agentCall: () => Effect.succeed({ op: "agent.list" as const, agents: [] }),
		getProviderAccountUsage: () => Effect.succeed([]),
		listProviderSessions: () => Effect.succeed([]),
		listProviderProjects: () => Effect.succeed([]),
		importProviderSession: () =>
			Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
		events: () => {
			throw new Error("not used by followTerminal");
		},
	};
	return { client, callCount: () => calls };
};

describe("followTerminal poll retry (defect 2: poll dies permanently)", () => {
	it("survives a single transient RPC failure and keeps polling instead of ending the fiber", async () => {
		const { client } = fakeFlakyClient({
			failureCount: 1,
			outputAfterRecovery: "QA_TERMINAL_42\n",
		});
		const snapshots: (ProjectedTerminal | null)[] = [];
		let ticks = 0;

		await Effect.runPromise(
			followTerminal({
				client,
				terminalId: TerminalId.make("term-1"),
				isActive: () => {
					ticks += 1;
					return ticks <= 10;
				},
				onSnapshot: (terminal) => {
					snapshots.push(terminal);
				},
				pollIntervalMillis: 0,
			})
		);

		// A single transient failure must not end the fiber: a snapshot from
		// the successful tick after it should still have been delivered.
		expect(snapshots.some((s) => s?.output === "QA_TERMINAL_42\n")).toBe(true);
	});

	it("surfaces an error once transient failures exceed the consecutive-failure cap", async () => {
		const { client } = fakeFlakyClient({ failureCount: 100, outputAfterRecovery: "unreachable" });

		const exit = await Effect.runPromiseExit(
			followTerminal({
				client,
				terminalId: TerminalId.make("term-1"),
				isActive: () => true,
				onSnapshot: () => {},
				pollIntervalMillis: 0,
				maxConsecutiveFailures: 3,
			})
		);

		expect(exit._tag).toBe("Failure");
	});
});

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
