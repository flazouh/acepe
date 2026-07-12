import { describe, expect, it } from "vitest";

import { linearIconData } from "../linear-icon-catalog.js";
import {
	getLinearInterfaceIconEvidence,
	resolveLinearInterfaceIconGlyph,
} from "../linear-interface-icon.js";
import { roundedIconData } from "../rounded-icon-data.generated.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("linear-interface-icon", () => {
	it("resolves the approved Linear Copy ID control icon", () => {
		const glyph = resolveLinearInterfaceIconGlyph("copy-id");

		expect(glyph.viewBox).toBe(linearIconData["copy-id"].viewBox);
		expect(glyph.inner).toBe(linearIconData["copy-id"].inner);
		expect(getLinearInterfaceIconEvidence("copy-id")).toMatchObject({
			linearName: "copy-id",
			controlLabel: "Copy ID",
			sourceChunk: "AgentToolbarActions",
			originalName: "CopyIdIcon",
			evidenceState: "approved",
		});
	});

	it("resolves the approved Linear settings General row icon", () => {
		const glyph = resolveLinearInterfaceIconGlyph("settings-general");

		expect(glyph.viewBox).toBe(linearIconData["feature-svg6bdd3b6f165e"].viewBox);
		expect(glyph.inner).toBe(linearIconData["feature-svg6bdd3b6f165e"].inner);
		expect(getLinearInterfaceIconEvidence("settings-general")).toMatchObject({
			linearName: "feature-svg6bdd3b6f165e",
			surface: "Linear workspace settings",
			controlLabel: "General",
			sourceChunk: "RegisterAction",
			originalName: "FeatureSvg6bdd3b6f165eIcon",
			evidenceState: "approved",
		});
	});

	it("resolves the approved Linear open in new window control icon", () => {
		const glyph = resolveLinearInterfaceIconGlyph("open-in-new-window");

		expect(glyph.viewBox).toBe(linearIconData["open-in-new-window"].viewBox);
		expect(glyph.inner).toBe(linearIconData["open-in-new-window"].inner);
		expect(getLinearInterfaceIconEvidence("open-in-new-window")).toMatchObject({
			linearName: "open-in-new-window",
			controlLabel: "Open in new window",
			sourceChunk: "AgentToolbarActions",
			originalName: "OpenInNewWindowIcon",
			evidenceState: "approved",
		});
	});

	it("does not turn the generic rounded copy icon into Copy ID", () => {
		const roundedCopy = resolveRoundedIconGlyph("copy");

		expect(roundedCopy.viewBox).toBe(roundedIconData.copy.viewBox);
		expect(roundedCopy.inner).toBe(roundedIconData.copy.inner);
	});

	it("does not turn the generic rounded settings icon into the settings General row icon", () => {
		const roundedSettings = resolveRoundedIconGlyph("settings");

		expect(roundedSettings.viewBox).toBe(roundedIconData.settings.viewBox);
		expect(roundedSettings.inner).toBe(roundedIconData.settings.inner);
	});
});
