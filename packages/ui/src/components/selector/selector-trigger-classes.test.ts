import { describe, expect, test } from "vitest";

import {
	getSelectorTriggerButtonVariant,
	resolveSelectorTriggerSize,
} from "./selector-trigger-classes.js";

describe("getSelectorTriggerButtonVariant", () => {
	test("uses chromeIcon for fused composer and setup chip triggers", () => {
		expect(getSelectorTriggerButtonVariant("composerChipLabel")).toBe("chromeIcon");
		expect(getSelectorTriggerButtonVariant("composerChipIcon")).toBe("chromeIcon");
		expect(getSelectorTriggerButtonVariant("setupBarChip")).toBe("chromeIcon");
		expect(getSelectorTriggerButtonVariant("setupBarChipGrouped")).toBe("chromeIcon");
	});

	test("uses ghost for transparent pill-style triggers", () => {
		expect(getSelectorTriggerButtonVariant("pill")).toBe("ghost");
		expect(getSelectorTriggerButtonVariant("minimal")).toBe("ghost");
		expect(getSelectorTriggerButtonVariant("footer")).toBe("ghost");
	});

	test("uses chromeIcon for icon rail triggers", () => {
		expect(getSelectorTriggerButtonVariant("icon")).toBe("chromeIcon");
		expect(getSelectorTriggerButtonVariant("chromeIcon")).toBe("chromeIcon");
		expect(getSelectorTriggerButtonVariant("chromeIconMd")).toBe("chromeIcon");
	});

	test("resolveSelectorTriggerSize is identity", () => {
		expect(resolveSelectorTriggerSize("setupBarChip")).toBe("setupBarChip");
		expect(resolveSelectorTriggerSize("composerChipIcon")).toBe("composerChipIcon");
	});
});
