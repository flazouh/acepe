import { describe, expect, it } from "bun:test";

import { buildCopyButtonDisplayState, getCopyButtonVariantFlags } from "./copy-button-state.js";

describe("copy-button-state", () => {
	it("builds uncontrolled inline state", () => {
		const state = buildCopyButtonDisplayState({
			variant: "inline",
			internalCopied: false,
		});

		expect(state.isControlled).toBe(false);
		expect(state.copied).toBe(false);
		expect(state.title).toBe("Copy");
		expect(state.showLabel).toBe(false);
		expect(state.baseClass).toContain("shrink-0");
		expect(state.colorClass).toBe("");
	});

	it("uses controlled copied state and copied title", () => {
		const state = buildCopyButtonDisplayState({
			variant: "footer",
			onClick: () => {},
			controlledCopied: true,
			internalCopied: false,
			titleOverride: "Copy text",
		});

		expect(state.isControlled).toBe(true);
		expect(state.copied).toBe(true);
		expect(state.title).toBe("Copied!");
		expect(state.colorClass).toBe("text-emerald-500");
	});

	it("uses the title override when not copied", () => {
		const state = buildCopyButtonDisplayState({
			variant: "icon",
			internalCopied: false,
			titleOverride: "Copy path",
		});

		expect(state.title).toBe("Copy path");
	});

	it("shows menu labels without truncation", () => {
		const state = buildCopyButtonDisplayState({
			variant: "menu",
			label: "Copy",
			internalCopied: false,
		});

		expect(state.showLabel).toBe(true);
		expect(state.labelClass).toBe("");
		expect(state.baseClass).toContain("w-full");
	});

	it("shows inline labels with truncation", () => {
		const state = buildCopyButtonDisplayState({
			variant: "inline",
			label: "Copy long text",
			internalCopied: false,
		});

		expect(state.showLabel).toBe(true);
		expect(state.labelClass).toBe("truncate");
		expect(state.baseClass).toContain("gap-1");
	});

	it("reports variant flags", () => {
		expect(getCopyButtonVariantFlags("embedded")).toEqual({
			isFooter: false,
			isIcon: false,
			isMenu: false,
			isEmbedded: true,
			isInlineWithLabel: false,
		});
	});
});
