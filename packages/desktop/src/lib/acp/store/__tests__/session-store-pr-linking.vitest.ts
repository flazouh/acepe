import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrChecks, PrDetails } from "../../../utils/tauri-client/git.js";

const setSessionPrNumberMock = vi.fn();
const prDetailsMock = vi.fn();
const prChecksMock = vi.fn();
const resolveAutomaticSessionPrNumberFromShipWorkflowMock = vi.fn();

vi.mock("../api.js", () => ({
	api: {
		getSession: vi.fn(),
		scanSessions: vi.fn(),
		sendPrompt: vi.fn(),
	},
}));

vi.mock("../../../utils/tauri-client.js", () => ({
	tauriClient: {
		git: {
			prDetails: prDetailsMock,
			prChecks: prChecksMock,
		},
		history: {
			setSessionPrNumber: setSessionPrNumberMock,
		},
	},
}));

vi.mock("../agent-model-preferences-store.svelte.js", () => ({
	clearSessionModelPerMode: vi.fn(),
}));

vi.mock("../services/session-pr-link-attribution.js", () => ({
	resolveAutomaticSessionPrNumberFromShipWorkflow:
		resolveAutomaticSessionPrNumberFromShipWorkflowMock,
}));

import { SessionStore } from "../session-store.svelte.js";

function createPrDetails(overrides: Partial<PrDetails> = {}): PrDetails {
	return {
		number: overrides.number ?? 42,
		title: overrides.title ?? "Feature PR",
		body: overrides.body ?? "Summary",
		state: overrides.state ?? "OPEN",
		url: overrides.url ?? "https://github.com/flazouh/acepe/pull/42",
		isDraft: overrides.isDraft ?? false,
		additions: overrides.additions ?? 12,
		deletions: overrides.deletions ?? 4,
		commits: overrides.commits ?? [],
	};
}

function createPrChecks(overrides: Partial<PrChecks> = {}): PrChecks {
	return {
		prNumber: overrides.prNumber ?? 42,
		headSha: overrides.headSha ?? "abc123",
		checkRuns: overrides.checkRuns ?? [],
	};
}

describe("SessionStore PR linking", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
		setSessionPrNumberMock.mockReset();
		setSessionPrNumberMock.mockReturnValue(okAsync(undefined));
		prDetailsMock.mockReset();
		prDetailsMock.mockReturnValue(okAsync(createPrDetails()));
		prChecksMock.mockReset();
		prChecksMock.mockReturnValue(okAsync(createPrChecks()));
		resolveAutomaticSessionPrNumberFromShipWorkflowMock.mockReset();
	});

	it("persists manual PR overrides with a shared linked PR projection", async () => {
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "Test session",
			updatedAt: new Date("2026-04-23T20:00:00.000Z"),
			createdAt: new Date("2026-04-23T19:00:00.000Z"),
			parentId: null,
		});

		await store.updateSessionPrLink("session-1", "/repo", 42, "manual");

		const session = store.getSessionCold("session-1");
		expect(session?.prNumber).toBe(42);
		expect(session?.prLinkMode).toBe("manual");
		expect(session?.linkedPr?.prNumber).toBe(42);
		expect(setSessionPrNumberMock).toHaveBeenCalledWith("session-1", 42, "manual");
	});

	it("ignores automatic ship workflow candidates while manual mode is active", async () => {
		store.addSession({
			id: "session-1",
			projectPath: "/repo",
			agentId: "cursor",
			title: "Manual session",
			prNumber: 17,
			prLinkMode: "manual",
			linkedPr: {
				prNumber: 17,
				state: "OPEN",
				url: "https://github.com/flazouh/acepe/pull/17",
				title: "Pinned PR",
				additions: 1,
				deletions: 2,
				isDraft: false,
				isLoading: false,
				hasResolvedDetails: true,
				checksHeadSha: null,
				checks: [],
				isChecksLoading: false,
				hasResolvedChecks: false,
			},
			updatedAt: new Date("2026-04-23T20:00:00.000Z"),
			createdAt: new Date("2026-04-23T19:00:00.000Z"),
			parentId: null,
		});
		resolveAutomaticSessionPrNumberFromShipWorkflowMock.mockReturnValue(okAsync(99));

		const applied = await store.applyAutomaticPrLinkFromShipWorkflow("session-1", "/repo", {
			status: "created",
			number: 99,
			url: "https://github.com/flazouh/acepe/pull/99",
		});

		expect(applied._unsafeUnwrap()).toBeNull();
		expect(store.getSessionCold("session-1")?.prNumber).toBe(17);
		expect(setSessionPrNumberMock).not.toHaveBeenCalled();
	});
});
