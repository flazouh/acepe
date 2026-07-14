import { describe, expect, it } from "vitest";

import {
	hugeiconsIconDataUri,
	isHugeiconsIconName,
	resolveHugeiconsIcon,
} from "../hugeicons-icon-registry.js";

describe("hugeicons icon registry", () => {
	it("resolves the runtime icon names used by the design system", () => {
		for (const name of ["settings", "copy-id", "folder", "chevron-down", "database"]) {
			expect(isHugeiconsIconName(name)).toBe(true);
			expect(resolveHugeiconsIcon(name).length).toBeGreaterThan(0);
		}
	});

	it("uses a visible Hugeicons fallback for unknown names", () => {
		expect(resolveHugeiconsIcon("missing-icon").length).toBeGreaterThan(0);
	});

	it("serializes registered icons as self-contained SVG data", () => {
		expect(hugeiconsIconDataUri("folder")).toMatch(/^data:image\/svg\+xml,/);
		expect(decodeURIComponent(hugeiconsIconDataUri("folder"))).toContain("<svg");
	});
});
