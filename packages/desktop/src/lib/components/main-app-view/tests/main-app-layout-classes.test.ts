import { describe, expect, it } from "vitest";

import {
	resolveWorkspaceFrameClass,
	resolveWorkspaceSidebarClass,
} from "../logic/main-app-layout-classes.js";

function toClassList(className: string): string[] {
	return className.split(/\s+/).filter((token) => token.length > 0);
}

describe("main app layout classes", () => {
	it("does not animate workspace width when the sidebar is restored after fullscreen", () => {
		const frameClasses = toClassList(resolveWorkspaceFrameClass());
		const sidebarClasses = toClassList(resolveWorkspaceSidebarClass(true));

		expect(frameClasses).not.toContain("transition-[padding]");
		expect(sidebarClasses).not.toContain("transition-[width,opacity]");
		expect(sidebarClasses).not.toContain("duration-200");
		expect(sidebarClasses).not.toContain("ease-out");
	});

	it("still collapses the sidebar immediately when hidden", () => {
		const sidebarClasses = toClassList(resolveWorkspaceSidebarClass(false));

		expect(sidebarClasses).toContain("w-0");
		expect(sidebarClasses).toContain("opacity-0");
		expect(sidebarClasses).toContain("pointer-events-none");
	});
});
