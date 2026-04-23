import { okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrChecks, PrDetails } from "../../../utils/tauri-client/git.js";
import type { AppError } from "../../errors/app-error.js";
import { AgentError } from "../../errors/app-error.js";

const prDetailsMock =
	vi.fn<(projectPath: string, prNumber: number) => ResultAsync<PrDetails, AppError>>();
const prChecksMock =
	vi.fn<(projectPath: string, prNumber: number) => ResultAsync<PrChecks, AppError>>();

vi.mock("../api.js", () => ({
	api: {
		getSession: vi.fn(),
		scanSessions: vi.fn(),
		sendPrompt: vi.fn(),
	},
}));

vi.mock("../../../utils/tauri-client.js", () => ({
	openFileInEditor: vi.fn(),
	revealInFinder: vi.fn(),
		tauriClient: {
			git: {
				prDetails: prDetailsMock,
				prChecks: prChecksMock,
			},
		},
	}));

vi.mock("../agent-model-preferences-store.svelte.js", () => ({
	clearSessionModelPerMode: vi.fn(),
}));

import { SessionStore } from "../session-store.svelte.js";

function createPrDetails(overrides: Partial<PrDetails> = {}): PrDetails {
	return {
		number: overrides.number ?? 83,
		title: overrides.title ?? "Test PR",
		body: overrides.body ?? "Summary",
		state: overrides.state ?? "OPEN",
		url: overrides.url ?? "https://github.com/example/repo/pull/83",
		isDraft: overrides.isDraft ?? false,
		additions: overrides.additions ?? 10,
		deletions: overrides.deletions ?? 3,
		commits: overrides.commits ?? [],
	};
}

function addSessionWithPr(store: SessionStore, sessionId: string, prNumber: number): void {
	store.addSession({
		id: sessionId,
		projectPath: "/test/path",
		agentId: "cursor",
		title: `Session ${sessionId}`,
		prNumber,
		prState: undefined,
		updatedAt: new Date(),
		createdAt: new Date(),
		parentId: null,
	});
}

function createPrChecks(overrides: Partial<PrChecks> = {}): PrChecks {
	return {
		prNumber: overrides.prNumber ?? 83,
		headSha: overrides.headSha ?? "abc123",
		checkRuns:
			overrides.checkRuns ??
			[
				{
					name: "build",
					status: "IN_PROGRESS",
					conclusion: null,
					detailsUrl: "https://github.com/example/repo/actions/runs/1",
					startedAt: "2026-04-23T12:00:00Z",
					completedAt: null,
					workflowName: "CI",
				},
			],
	};
}

describe("SessionStore PR state refresh caching", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		prDetailsMock.mockReset();
		prChecksMock.mockReset();
		prChecksMock.mockReturnValue(okAsync(createPrChecks()));
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("reuses cached PR details for repeated refreshes", async () => {
		addSessionWithPr(store, "session-pr-1", 83);
		prDetailsMock.mockReturnValue(okAsync(createPrDetails()));

		await store.refreshSessionPrState("session-pr-1", "/test/path", 83);
		await store.refreshSessionPrState("session-pr-1", "/test/path", 83);

		expect(prDetailsMock).toHaveBeenCalledTimes(1);
		expect(store.getSessionCold("session-pr-1")?.prState).toBe("OPEN");
		expect(store.getSessionCold("session-pr-1")?.linkedPr?.title).toBe("Test PR");
		expect(store.getSessionCold("session-pr-1")?.linkedPr?.additions).toBe(10);
		expect(store.getSessionCold("session-pr-1")?.linkedPr?.checksHeadSha).toBe("abc123");
	});

	it("preserves historical updatedAt when PR state refresh changes prState", async () => {
		vi.setSystemTime(new Date("2026-03-31T12:00:00.000Z"));
		const previousUpdatedAt = new Date("2026-03-01T08:30:00.000Z");

		store.addSession({
			id: "session-pr-1",
			projectPath: "/test/path",
			agentId: "cursor",
			title: "Historical session",
			prNumber: 83,
			prState: "OPEN",
			updatedAt: previousUpdatedAt,
			createdAt: new Date("2026-02-28T18:00:00.000Z"),
			parentId: null,
		});
		prDetailsMock.mockReturnValue(okAsync(createPrDetails({ state: "MERGED" })));

		await store.refreshSessionPrState("session-pr-1", "/test/path", 83);

		expect(store.getSessionCold("session-pr-1")?.prState).toBe("MERGED");
		expect(store.getSessionCold("session-pr-1")?.updatedAt.toISOString()).toBe(
			previousUpdatedAt.toISOString()
		);
	});

	it("dedupes in-flight requests for the same PR", async () => {
		addSessionWithPr(store, "session-pr-1", 83);
		addSessionWithPr(store, "session-pr-2", 83);

		let resolveDetails: ((details: PrDetails) => void) | undefined;
		const detailsPromise = new Promise<PrDetails>((resolve) => {
			resolveDetails = resolve;
		});

		prDetailsMock.mockReturnValue(
			ResultAsync.fromPromise(detailsPromise, () => new AgentError("prDetails"))
		);

		const firstRequest = store.refreshSessionPrState("session-pr-1", "/test/path", 83);
		const secondRequest = store.refreshSessionPrState("session-pr-2", "/test/path", 83);

		expect(prDetailsMock).toHaveBeenCalledTimes(1);

		resolveDetails?.(createPrDetails());

		await firstRequest;
		await secondRequest;

		expect(store.getSessionCold("session-pr-1")?.prState).toBe("OPEN");
		expect(store.getSessionCold("session-pr-2")?.prState).toBe("OPEN");
	});

	it("refreshes again after the cache ttl expires", async () => {
		addSessionWithPr(store, "session-pr-1", 83);
		prDetailsMock.mockReturnValue(okAsync(createPrDetails()));

		await store.refreshSessionPrState("session-pr-1", "/test/path", 83);
		vi.advanceTimersByTime(60_001);
		await store.refreshSessionPrState("session-pr-1", "/test/path", 83);

		expect(prDetailsMock).toHaveBeenCalledTimes(2);
	});

	it("dedupes in-flight requests for PR checks and applies them to linked PRs", async () => {
		addSessionWithPr(store, "session-pr-1", 83);
		addSessionWithPr(store, "session-pr-2", 83);

		let resolveChecks: ((checks: PrChecks) => void) | undefined;
		const checksPromise = new Promise<PrChecks>((resolve) => {
			resolveChecks = resolve;
		});

		prChecksMock.mockReturnValue(
			ResultAsync.fromPromise(checksPromise, () => new AgentError("prChecks"))
		);

		const firstRequest = store.refreshSessionPrChecks("session-pr-1", "/test/path", 83);
		const secondRequest = store.refreshSessionPrChecks("session-pr-2", "/test/path", 83);

		expect(prChecksMock).toHaveBeenCalledTimes(1);

		resolveChecks?.(createPrChecks({ checkRuns: [] }));

		await firstRequest;
		await secondRequest;

		expect(store.getSessionCold("session-pr-1")?.linkedPr?.hasResolvedChecks).toBe(true);
		expect(store.getSessionCold("session-pr-2")?.linkedPr?.checks).toEqual([]);
	});
});
