import { describe, expect, test } from "vitest";

import {
	getSelectorTriggerButtonPropsForContext,
	getSelectorTriggerButtonSize,
	getSelectorTriggerButtonSizeForContext,
	getSelectorTriggerButtonVariant,
	resolveSelectorTriggerSize,
} from "./selector-trigger-classes.js";

describe("getSelectorTriggerButtonVariant", () => {
	test("uses secondary for labeled setup and composer chip triggers", () => {
		expect(getSelectorTriggerButtonVariant("composerChipLabel")).toBe("secondary");
		expect(getSelectorTriggerButtonVariant("setupBarChip")).toBe("secondary");
		expect(getSelectorTriggerButtonVariant("setupBarChipGrouped")).toBe("secondary");
	});

	test("uses ghost for icon-only composer chip triggers", () => {
		expect(getSelectorTriggerButtonVariant("composerChipIcon")).toBe("ghost");
	});

	test("uses ghost for transparent pill-style triggers", () => {
		expect(getSelectorTriggerButtonVariant("pill")).toBe("ghost");
		expect(getSelectorTriggerButtonVariant("minimal")).toBe("ghost");
		expect(getSelectorTriggerButtonVariant("footer")).toBe("ghost");
	});

	test("uses ghost for icon rail triggers", () => {
		expect(getSelectorTriggerButtonVariant("icon")).toBe("ghost");
		expect(getSelectorTriggerButtonVariant("iconSm")).toBe("ghost");
		expect(getSelectorTriggerButtonVariant("chromeIcon")).toBe("ghost");
		expect(getSelectorTriggerButtonVariant("chromeIconMd")).toBe("ghost");
	});

	test("uses secondary for header action triggers", () => {
		expect(getSelectorTriggerButtonVariant("headerAction")).toBe("secondary");
	});
});

describe("getSelectorTriggerButtonSize icon rails", () => {
	test("maps chrome icon triggers to icon", () => {
		expect(getSelectorTriggerButtonSize("chromeIcon")).toBe("icon");
		expect(getSelectorTriggerButtonSize("chromeIconMd")).toBe("icon");
	});

	test("keeps dense icon triggers compact", () => {
		expect(getSelectorTriggerButtonSize("icon")).toBe("icon");
		expect(getSelectorTriggerButtonSize("iconSm")).toBe("icon-sm");
		expect(getSelectorTriggerButtonSize("attach")).toBe("icon");
	});

	test("maps header action triggers to xs", () => {
		expect(getSelectorTriggerButtonSize("headerAction")).toBe("xs");
	});
});

describe("getSelectorTriggerButtonSize", () => {
	test("maps fused chip triggers to shadcn sizes", () => {
		expect(getSelectorTriggerButtonSize("setupBarChip")).toBe("sm");
		expect(getSelectorTriggerButtonSize("setupBarChipGrouped")).toBe("sm");
		expect(getSelectorTriggerButtonSize("composerChipLabel")).toBe("sm");
		expect(getSelectorTriggerButtonSize("composerChipIcon")).toBe("icon-sm");
	});
});

describe("getSelectorTriggerButtonSizeForContext", () => {
	test("uses icon-sm-narrow for embedded composerChipIcon", () => {
		expect(
			getSelectorTriggerButtonSizeForContext({
				triggerSize: "composerChipIcon",
				embeddedInGroup: true,
			})
		).toBe("icon-sm-narrow");
		expect(
			getSelectorTriggerButtonSizeForContext({
				triggerSize: "composerChipIcon",
				embeddedInGroup: false,
			})
		).toBe("icon-sm");
	});
});

describe("getSelectorTriggerButtonPropsForContext", () => {
	test("maps embedded composerChipIcon to secondary icon-sm-narrow", () => {
		expect(
			getSelectorTriggerButtonPropsForContext({
				triggerSize: "composerChipIcon",
				embeddedInGroup: true,
			})
		).toEqual({ variant: "secondary", size: "icon-sm-narrow" });
	});

	test("maps standalone composerChipIcon to ghost icon-sm", () => {
		expect(
			getSelectorTriggerButtonPropsForContext({
				triggerSize: "composerChipIcon",
				embeddedInGroup: false,
			})
		).toEqual({ variant: "ghost", size: "icon-sm" });
	});

	test("maps setupBarChipGrouped to secondary sm", () => {
		expect(
			getSelectorTriggerButtonPropsForContext({
				triggerSize: "setupBarChipGrouped",
				embeddedInGroup: true,
			})
		).toEqual({ variant: "secondary", size: "sm" });
	});

	test("uses variant prop for non-fused triggers", () => {
		expect(
			getSelectorTriggerButtonPropsForContext({
				triggerSize: "default",
				embeddedInGroup: false,
				variant: "outline",
			})
		).toEqual({ variant: "outline", size: "sm" });
	});
});

describe("resolveSelectorTriggerSize", () => {
	test("is identity", () => {
		expect(resolveSelectorTriggerSize("setupBarChip")).toBe("setupBarChip");
		expect(resolveSelectorTriggerSize("composerChipIcon")).toBe("composerChipIcon");
	});
});
