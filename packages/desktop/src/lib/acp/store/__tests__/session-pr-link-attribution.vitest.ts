import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRepoContextMock = vi.fn();

vi.mock("../../services/github-service.js", () => ({
	getRepoContext: getRepoContextMock,
}));

import { resolveAutomaticSessionPrNumberFromShipWorkflow } from "../services/session-pr-link-attribution.js";

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
