import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./dismissable-tooltip.svelte"), "utf8");

describe("dismissable-tooltip contract", () => {
	it("renders only children when dismissed is true", () => {
		expect(source).toContain("{#if dismissed}");
		expect(source).toContain("{@render children()}");
	});

	it("wraps children in a tooltip when not dismissed", () => {
		expect(source).toContain("<TooltipPrimitive.Provider");
		expect(source).toContain("<TooltipPrimitive.Root");
		expect(source).toContain("<TooltipPrimitive.Trigger");
		expect(source).toContain("<TooltipPrimitive.Content");
	});

	it("opens only from hover on the explicit trigger wrapper", () => {
		expect(source).toContain("onpointermove={requestOpen}");
		expect(source).toContain("onpointerleave={requestClose}");
		expect(source).not.toContain("onpointerenter={requestOpen}");
		expect(source).not.toContain("onclick={requestOpen}");
	});

	it("keeps the tooltip enterable and dismissable", () => {
		expect(source).toContain("disableHoverableContent={false}");
		expect(source).toContain("onpointerenter={cancelClose}");
		expect(source).toContain("onpointerleave={requestClose}");
		expect(source).toContain('aria-label="Dismiss this tip"');
		expect(source).toContain("onclick={handleDismiss}");
	});
});
