import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRepoContextMock = vi.fn();

vi.mock("../../services/github-service.js", () => ({
	getRepoContext: getRepoContextMock,
}));

import {
	extractPrCandidateFromGhCreateToolCall,
	resolveAutomaticSessionPrNumberFromShipWorkflow,
	resolveAutomaticSessionPrNumberFromToolCall,
} from "../services/session-pr-link-attribution.js";

describe("session PR link attribution", () => {
	beforeEach(() => {
		getRepoContextMock.mockReset();
	});

	it("accepts verified ship workflow results for the current repository", async () => {
		getRepoContextMock.mockReturnValue(
			okAsync({
				owner: "flazouh",
				repo: "acepe",
				remoteUrl: "https://github.com/flazouh/acepe",
			})
		);

		const result = await resolveAutomaticSessionPrNumberFromShipWorkflow("/repo", {
			status: "created",
			number: 178,
			url: "https://github.com/flazouh/acepe/pull/178",
		});

		expect(result._unsafeUnwrap()).toBe(178);
	});

	it("rejects cross-repository pull request results", async () => {
		getRepoContextMock.mockReturnValue(
			okAsync({
				owner: "flazouh",
				repo: "acepe",
				remoteUrl: "https://github.com/flazouh/acepe",
			})
		);

		const result = await resolveAutomaticSessionPrNumberFromShipWorkflow("/repo", {
			status: "opened_existing",
			number: 42,
			url: "https://github.com/other/repo/pull/42",
		});

		expect(result._unsafeUnwrap()).toBeNull();
	});

	it("fails closed when repo lookup fails", async () => {
		getRepoContextMock.mockReturnValue(errAsync(new Error("lookup failed")));

		const result = await resolveAutomaticSessionPrNumberFromShipWorkflow("/repo", {
			status: "created",
			number: 91,
			url: "https://github.com/flazouh/acepe/pull/91",
		});

		expect(result._unsafeUnwrap()).toBeNull();
	});
});

describe("gh pr create tool-call attribution", () => {
	beforeEach(() => {
		getRepoContextMock.mockReset();
	});

	describe("extractPrCandidateFromGhCreateToolCall", () => {
		it("extracts the printed PR from a gh pr create command", () => {
			const candidate = extractPrCandidateFromGhCreateToolCall(
				`gh pr create --repo flazouh/acepe --base main --head feature --title "x" --body "y"`,
				"Warning: 3 uncommitted changes\nhttps://github.com/flazouh/acepe/pull/1756\n"
			);

			expect(candidate).toEqual({ owner: "flazouh", repo: "acepe", prNumber: 1756 });
		});

		it("returns the first PR URL when several are printed (first-seen wins)", () => {
			const candidate = extractPrCandidateFromGhCreateToolCall(
				"gh pr create --fill",
				"https://github.com/flazouh/acepe/pull/10\nhttps://github.com/flazouh/acepe/pull/11"
			);

			expect(candidate?.prNumber).toBe(10);
		});

		it("ignores commands that are not gh pr create (no passive-mention auto-link)", () => {
			expect(
				extractPrCandidateFromGhCreateToolCall(
					"gh pr view 1756",
					"https://github.com/flazouh/acepe/pull/1756"
				)
			).toBeNull();
			expect(
				extractPrCandidateFromGhCreateToolCall(
					"echo see https://github.com/flazouh/acepe/pull/1756",
					"https://github.com/flazouh/acepe/pull/1756"
				)
			).toBeNull();
		});

		it("returns null when the create command printed no PR URL", () => {
			expect(
				extractPrCandidateFromGhCreateToolCall("gh pr create --fill", "error: no commits between...")
			).toBeNull();
			expect(extractPrCandidateFromGhCreateToolCall("gh pr create", null)).toBeNull();
			expect(extractPrCandidateFromGhCreateToolCall(null, "anything")).toBeNull();
		});
	});

	it("accepts a current-repo PR created via gh pr create", async () => {
		getRepoContextMock.mockReturnValue(
			okAsync({ owner: "flazouh", repo: "acepe", remoteUrl: "https://github.com/flazouh/acepe" })
		);

		const result = await resolveAutomaticSessionPrNumberFromToolCall(
			"/repo",
			"gh pr create --fill",
			"https://github.com/flazouh/acepe/pull/1756"
		);

		expect(result._unsafeUnwrap()).toBe(1756);
	});

	it("rejects a PR created for a different repository", async () => {
		getRepoContextMock.mockReturnValue(
			okAsync({ owner: "flazouh", repo: "acepe", remoteUrl: "https://github.com/flazouh/acepe" })
		);

		const result = await resolveAutomaticSessionPrNumberFromToolCall(
			"/repo",
			"gh pr create --fill",
			"https://github.com/other/repo/pull/1756"
		);

		expect(result._unsafeUnwrap()).toBeNull();
	});

	it("fails closed when repo lookup fails", async () => {
		getRepoContextMock.mockReturnValue(errAsync(new Error("lookup failed")));

		const result = await resolveAutomaticSessionPrNumberFromToolCall(
			"/repo",
			"gh pr create --fill",
			"https://github.com/flazouh/acepe/pull/1756"
		);

		expect(result._unsafeUnwrap()).toBeNull();
	});
});
