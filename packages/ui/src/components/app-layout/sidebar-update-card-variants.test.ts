import { describe, expect, it } from "vitest";

import {
	DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT,
	SIDEBAR_UPDATE_CARD_VARIANTS,
	getSidebarUpdateCardCopy,
	getSidebarUpdateCardVariantDefinition,
} from "./sidebar-update-card-variants.js";

describe("sidebar-update-card-variants", () => {
	it("defines ten gradient variants", () => {
		expect(SIDEBAR_UPDATE_CARD_VARIANTS).toHaveLength(10);
		expect(SIDEBAR_UPDATE_CARD_VARIANTS.map((entry) => entry.id)).toEqual([
			"luminar-blob",
			"luminar-wave",
			"luminar-corners",
			"luminar-ripple",
			"luminar-dots",
			"acepe-warm",
			"luminar-vivid",
			"luminar-soft",
			"luminar-rose",
			"luminar-pill",
		]);
	});

	it("defaults to luminar-wave", () => {
		expect(DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT).toBe("luminar-wave");
	});

	it("uses gradient card copy for available state", () => {
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

	it("uses dark surface tokens for acepe-warm", () => {
		expect(getSidebarUpdateCardVariantDefinition("acepe-warm").surfaceTokens).toBe("dark");
	});
});
