import { describe, expect, it } from "vitest";

import { toolKindIconNameByKind } from "../../agent-panel/tool-kind-icon-model.js";
import {
	hugeiconsIconDataUri,
	isHugeiconsIconName,
	resolveHugeiconsIcon,
	type HugeiconsIconName,
} from "../hugeicons-icon-registry.js";

/** Every product/website call-site name that must resolve without the HelpCircle fallback. */
const requiredProductIconNames = [
	...Object.values(toolKindIconNameByKind),
	"globe",
	"git-pull-request",
	"history",
	"flask",
	"chart-line",
	"paper-plane",
	"unselected",
	"avatar",
	"sidebar-closed",
	"team",
	"permissions",
	"github-filled",
	"discord-filled",
	"twitter-filled",
] as const satisfies readonly HugeiconsIconName[];

describe("hugeicons icon registry", () => {
	it("resolves the runtime icon names used by the design system", () => {
		for (const name of ["settings", "copy-id", "folder", "chevron-down", "database"]) {
			expect(isHugeiconsIconName(name)).toBe(true);
			expect(resolveHugeiconsIcon(name).length).toBeGreaterThan(0);
		}
	});

	it("registers every tool-kind icon name used by the agent panel", () => {
		for (const [kind, name] of Object.entries(toolKindIconNameByKind)) {
			expect(isHugeiconsIconName(name), `tool kind ${kind} → ${name}`).toBe(true);
			expect(resolveHugeiconsIcon(name)).not.toBe(resolveHugeiconsIcon("missing-icon"));
		}
	});

	it("registers every required product call-site icon name", () => {
		for (const name of requiredProductIconNames) {
			expect(isHugeiconsIconName(name), name).toBe(true);
		}
	});

	it("uses distinct icons for diff settings menu choices", () => {
		const diffSettingsIconNames = [
			"git-diff-unified",
			"diff-layout-split",
			"diff-bars",
			"diff-classic",
			"diff-inline-word",
			"diff-inline-character",
			"diff-backgrounds",
			"diff-wrapping",
			"diff-line-numbers",
		] as const satisfies readonly HugeiconsIconName[];

		const resolvedIcons = diffSettingsIconNames.map((name) => resolveHugeiconsIcon(name));

		expect(new Set(resolvedIcons).size).toBe(resolvedIcons.length);
	});

	it("uses a visible Hugeicons fallback only for truly unknown names", () => {
		expect(isHugeiconsIconName("missing-icon")).toBe(false);
		expect(resolveHugeiconsIcon("missing-icon").length).toBeGreaterThan(0);
	});

	it("serializes registered icons as self-contained SVG data", () => {
		expect(hugeiconsIconDataUri("folder")).toMatch(/^data:image\/svg\+xml,/);
		expect(decodeURIComponent(hugeiconsIconDataUri("folder"))).toContain("<svg");
	});
});
