import { describe, expect, it } from "vitest";

import {
	mapGitHubPrStateToLinearStatusIcon,
	mapUppercasePrStateToLinearStatusIcon,
	pullRequestLinearStatusIcons,
} from "../pull-request-status-icon.js";
import { roundedIconData } from "../rounded-icon-data.generated.js";
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

	it("keeps legacy RoundedIcon PR names on Acepe geometry while global mappings are retraced", () => {
		expect(mapRoundedIconToLinear("pull-request")).toBeNull();
		expect(mapRoundedIconToLinear("pull-request-merged")).toBeNull();
		expect(mapRoundedIconToLinear("pull-request-closed")).toBeNull();

		const openGlyph = resolveRoundedIconGlyph("pull-request");
		expect(openGlyph.inner).toBe(roundedIconData["pull-request"].inner);
	});
});
