import { describe, expect, it } from "vitest";

import {
	DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT,
	SIDEBAR_UPDATE_CARD_VARIANTS,
	getSidebarUpdateCardCopy,
	getSidebarUpdateCardVariantDefinition,
} from "./sidebar-update-card-variants.js";

describe("sidebar-update-card-variants", () => {
	it("defines the minimal variant", () => {
		expect(SIDEBAR_UPDATE_CARD_VARIANTS).toHaveLength(1);
		expect(SIDEBAR_UPDATE_CARD_VARIANTS.map((entry) => entry.id)).toEqual(["minimal"]);
	});

	it("defaults to minimal", () => {
		expect(DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT).toBe("minimal");
	});

	it("uses update card copy for available state", () => {
		expect(
			getSidebarUpdateCardCopy({
				kind: "available",
				version: "2026.4.4",
				percent: 0,
			}),
		).toEqual({
			title: "Version 2026.4.4, ready",
			ctaLabel: "Install",
			progressLabel: "Update available",
		});
	});

	it("uses indeterminate copy for installing", () => {
		expect(
			getSidebarUpdateCardCopy({
				kind: "installing",
				version: "2026.4.4",
				percent: 100,
			}).title,
		).toBe("Installing update");
	});

	it("uses minimal surface tokens", () => {
		expect(getSidebarUpdateCardVariantDefinition("minimal").surfaceTokens).toBe("minimal");
	});

	it("falls back to the default for unknown visual variant ids", () => {
		expect(getSidebarUpdateCardVariantDefinition("luminar-wave").id).toBe("minimal");
	});
});
