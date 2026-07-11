import { describe, expect, it } from "vitest";

import { linearIconData } from "../linear-icon-catalog.js";
import {
	mapGitHubPrStateToLinearStatusIcon,
	mapUppercasePrStateToLinearStatusIcon,
	pullRequestLinearStatusIcons,
} from "../pull-request-status-icon.js";
import { mapRoundedIconToLinear } from "../rounded-to-linear-map.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("pull-request-status-icon", () => {
	it("maps GitHub PR states to Linear status variants", () => {
		expect(mapGitHubPrStateToLinearStatusIcon("open")).toBe(
			pullRequestLinearStatusIcons.open,
		);
		expect(mapGitHubPrStateToLinearStatusIcon("merged")).toBe(
			pullRequestLinearStatusIcons.merged,
		);
		expect(mapGitHubPrStateToLinearStatusIcon("closed")).toBe(
			pullRequestLinearStatusIcons.closed,
		);
	});

	it("maps uppercase session PR states to the same Linear variants", () => {
		expect(mapUppercasePrStateToLinearStatusIcon("OPEN")).toBe(
			pullRequestLinearStatusIcons.open,
		);
		expect(mapUppercasePrStateToLinearStatusIcon("MERGED")).toBe(
			pullRequestLinearStatusIcons.merged,
		);
		expect(mapUppercasePrStateToLinearStatusIcon("CLOSED")).toBe(
			pullRequestLinearStatusIcons.closed,
		);
	});

	it("keeps legacy RoundedIcon PR names aligned with semantic Linear variants", () => {
		expect(mapRoundedIconToLinear("pull-request")).toBe(pullRequestLinearStatusIcons.open);
		expect(mapRoundedIconToLinear("pull-request-merged")).toBe(
			pullRequestLinearStatusIcons.merged,
		);
		expect(mapRoundedIconToLinear("pull-request-closed")).toBe(
			pullRequestLinearStatusIcons.closed,
		);

		const openGlyph = resolveRoundedIconGlyph("pull-request");
		expect(openGlyph.inner).toBe(
			linearIconData[pullRequestLinearStatusIcons.open].inner,
		);
	});
});
