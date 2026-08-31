/**
 * The messaging orchestrator's gate rejections must be observable in the logs.
 *
 * Observed live 2026-09-01: a send on an existing session failed with
 * SessionNotFoundError / ConnectionError BEFORE the orchestrator's own
 * "store entrypoint" log line, so a rejected send produced zero log output and
 * the failure was undiagnosable from the console.
 *
 * The logger is injected through deps (defaulting to the module logger) because
 * asserting on the global log store is unreliable: other bun test files
 * mock.module the logger module and bun module mocks leak across files.
 */
import { describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ConnectionError, SessionNotFoundError } from "../errors/app-error.js";
import {
	SessionMessagingOrchestrator,
	type SessionMessagingOrchestratorDeps,
} from "./session-messaging-orchestrator.js";

function makeRecordingLogger() {
	return {
		debug: mock((_message: string, _data?: unknown) => {}),
		info: mock((_message: string, _data?: unknown) => {}),
		warn: mock((_message: string, _data?: unknown) => {}),
	};
}

function makeDeps(
	overrides: Partial<SessionMessagingOrchestratorDeps> = {}
): SessionMessagingOrchestratorDeps {
	const deps: SessionMessagingOrchestratorDeps = {
		messagingSvc: {
			sendMessage: mock(() => Effect.void),
			sendPendingCreationMessage: mock(() => Effect.void),
		} as unknown as SessionMessagingOrchestratorDeps["messagingSvc"],
		creationCoordinator: {
			hasPendingCreation: () => false,
			completePendingCreation: () => {},
		} as unknown as SessionMessagingOrchestratorDeps["creationCoordinator"],
		getSessionIdentity: () =>
			({ id: "session-1" }) as unknown as ReturnType<
				SessionMessagingOrchestratorDeps["getSessionIdentity"]
			>,
		getSessionMetadata: () =>
			({
				title: "Session",
				sessionLifecycleState: "active",
				sourcePath: null,
			}) as unknown as ReturnType<SessionMessagingOrchestratorDeps["getSessionMetadata"]>,
		getSessionCanSend: () => true,
		getSessionLifecycleStatus: () => "ready",
		getGraphTranscriptRevision: () => 1,
		updateSession: () => {},
	};
	return { ...deps, ...overrides };
}

describe("SessionMessagingOrchestrator gate rejections", () => {
	it("logs a warning when the session identity is missing", async () => {
		const logger = makeRecordingLogger();
		const orchestrator = new SessionMessagingOrchestrator(
			makeDeps({ getSessionIdentity: () => undefined, logger })
		);

		const result = await Effect.runPromise(
			Effect.result(orchestrator.sendMessage("session-1", "hello"))
		);

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(SessionNotFoundError);
		}
		expect(logger.warn).toHaveBeenCalled();
	});

	it("logs a warning when the session metadata is missing", async () => {
		const logger = makeRecordingLogger();
		const orchestrator = new SessionMessagingOrchestrator(
			makeDeps({ getSessionMetadata: () => undefined, logger })
		);

		const result = await Effect.runPromise(
			Effect.result(orchestrator.sendMessage("session-1", "hello"))
		);

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(SessionNotFoundError);
		}
		expect(logger.warn).toHaveBeenCalled();
	});

	it("logs a warning when the canSend gate rejects the send", async () => {
		const logger = makeRecordingLogger();
		const orchestrator = new SessionMessagingOrchestrator(
			makeDeps({ getSessionCanSend: () => false, logger })
		);

		const result = await Effect.runPromise(
			Effect.result(orchestrator.sendMessage("session-1", "hello"))
		);

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(ConnectionError);
		}
		expect(logger.warn).toHaveBeenCalled();
	});

	it("logs no warning when the send passes the gates", async () => {
		const logger = makeRecordingLogger();
		const orchestrator = new SessionMessagingOrchestrator(makeDeps({ logger }));

		const result = await Effect.runPromise(
			Effect.result(orchestrator.sendMessage("session-1", "hello"))
		);

		expect(Result.isFailure(result)).toBe(false);
		expect(logger.warn).not.toHaveBeenCalled();
	});
});
