import { describe, expect, it } from "vitest";
import {
	resolveProjectDeckContainerClass,
	resolveProjectGroupDeckLayout,
} from "./project-deck-layout.js";

describe("project deck layout", () => {
	it("keeps inactive project groups measurable instead of display-none hidden", () => {
		const layout = resolveProjectGroupDeckLayout({
			activeProjectPath: "/projects/alpha",
			groupProjectPath: "/projects/beta",
			hasAgentPanels: true,
			isAgentFullscreenGroup: false,
		});

		expect(layout.isInactive).toBe(true);
		expect(layout.inert).toBe(true);
		expect(layout.ariaHidden).toBe("true");
		expect(layout.className.split(/\s+/)).toContain("invisible");
		expect(layout.className.split(/\s+/)).toContain("absolute");
		expect(layout.className.split(/\s+/)).not.toContain("hidden");
	});

	it("leaves the active project group visible and interactive", () => {
		const layout = resolveProjectGroupDeckLayout({
			activeProjectPath: "/projects/alpha",
			groupProjectPath: "/projects/alpha",
			hasAgentPanels: true,
			isAgentFullscreenGroup: false,
		});

		expect(layout.isInactive).toBe(false);
		expect(layout.inert).toBe(false);
		expect(layout.ariaHidden).toBe(undefined);
		expect(layout.className.split(/\s+/)).toContain("relative");
		expect(layout.className.split(/\s+/)).toContain("pointer-events-auto");
		expect(layout.className.split(/\s+/)).not.toContain("hidden");
	});

	it("allows horizontal overflow while a project is focused", () => {
		const className = resolveProjectDeckContainerClass("/projects/alpha");
		const classes = className.split(/\s+/);

		expect(classes).toContain("overflow-x-auto");
		expect(classes).toContain("overflow-y-hidden");
		expect(classes).not.toContain("overflow-hidden");
	});
});
