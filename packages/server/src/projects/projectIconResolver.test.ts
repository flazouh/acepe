// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
import { PROJECT_ICON_AUTO, PROJECT_ICON_NONE } from "@acepe/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveProjectIcon } from "./projectIconResolver.ts";

let root = "";

const write = (relativePath: string, contents = "x"): string => {
	const absolute = NodePath.join(root, relativePath);
	NodeFs.mkdirSync(NodePath.dirname(absolute), { recursive: true });
	NodeFs.writeFileSync(absolute, contents);
	return absolute;
};

// Each case gets its own temp root, so the resolver's per-project cache
// cannot leak an answer from one case into the next.
beforeEach(() => {
	root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "acepe-icon-"));
});

afterEach(() => {
	NodeFs.rmSync(root, { recursive: true, force: true });
});

describe("resolveProjectIcon", () => {
	it("detects a project's own logo under auto", () => {
		const absolute = write("logo.svg");
		expect(resolveProjectIcon(root, PROJECT_ICON_AUTO)).toBe(absolute);
	});

	it("answers null under auto when the project has no image", () => {
		write("README.md");
		expect(resolveProjectIcon(root, PROJECT_ICON_AUTO)).toBeNull();
	});

	it("answers null under none, even when an image is sitting there", () => {
		write("logo.svg");
		expect(resolveProjectIcon(root, PROJECT_ICON_NONE)).toBeNull();
	});

	it("returns the chosen file under custom", () => {
		const absolute = write("docs/brand/mark.png");
		expect(
			resolveProjectIcon(root, { kind: "custom", path: "docs/brand/mark.png" }),
		).toBe(absolute);
	});

	it("lets a custom pick beat a file detection would have found", () => {
		write("logo.svg");
		const chosen = write("assets/other.png");
		expect(
			resolveProjectIcon(root, { kind: "custom", path: "assets/other.png" }),
		).toBe(chosen);
	});

	it("falls back to the letter badge when a custom pick no longer exists", () => {
		// Deliberately does NOT re-detect: silently swapping in a different
		// picture would replace a choice the user made with one they did not.
		write("logo.svg");
		expect(
			resolveProjectIcon(root, { kind: "custom", path: "gone.png" }),
		).toBeNull();
	});

	it("answers null for a workspace root that is not there", () => {
		expect(
			resolveProjectIcon(NodePath.join(root, "missing"), PROJECT_ICON_AUTO),
		).toBeNull();
	});

	it("returns an absolute path", () => {
		write("logo.png");
		expect(resolveProjectIcon(root, PROJECT_ICON_AUTO)?.startsWith("/")).toBe(
			true,
		);
	});
});
