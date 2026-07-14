import { describe, expect, it } from "vitest";

import {
	mapGitHubPrStateToStatusIcon,
	mapUppercasePrStateToStatusIcon,
	pullRequestStatusIcons,
} from "../pull-request-status-icon.js";

describe("pull-request-status-icon", () => {
	it("maps GitHub PR states to Hugeicons status names", () => {
		expect(mapGitHubPrStateToStatusIcon("open")).toBe(
			pullRequestStatusIcons.open,
		);
		expect(mapGitHubPrStateToStatusIcon("merged")).toBe(
			pullRequestStatusIcons.merged,
		);
		expect(mapGitHubPrStateToStatusIcon("closed")).toBe(
			pullRequestStatusIcons.closed,
		);
	});

	it("maps uppercase session PR states to the same Hugeicons names", () => {
		expect(mapUppercasePrStateToStatusIcon("OPEN")).toBe(
			pullRequestStatusIcons.open,
		);
		expect(mapUppercasePrStateToStatusIcon("MERGED")).toBe(
			pullRequestStatusIcons.merged,
		);
		expect(mapUppercasePrStateToStatusIcon("CLOSED")).toBe(
			pullRequestStatusIcons.closed,
		);
	});
});
