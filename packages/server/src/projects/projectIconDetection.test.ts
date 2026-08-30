import { describe, expect, it } from "vitest";

import {
	detectProjectIcon,
	isProjectIconFile,
	type ProjectTree,
	projectIconCandidates,
} from "./projectIconDetection.ts";

/**
 * A project described by the paths it holds. Detection never touches a real
 * filesystem, so a case is a list of strings and a one-line assertion.
 */
const treeOf = (paths: ReadonlyArray<string>): ProjectTree => {
	const files = new Set(paths);
	return {
		isFile: (relativePath) => files.has(relativePath),
		listDirectories: (relativePath) => {
			const prefix = relativePath.length === 0 ? "" : `${relativePath}/`;
			const names = new Set<string>();
			for (const path of files) {
				if (!path.startsWith(prefix)) {
					continue;
				}
				const rest = path.slice(prefix.length);
				const slash = rest.indexOf("/");
				if (slash > 0) {
					names.add(rest.slice(0, slash));
				}
			}
			return [...names];
		},
	};
};

describe("detectProjectIcon", () => {
	it("finds nothing in an empty project", () => {
		expect(detectProjectIcon(treeOf([]))).toBeNull();
	});

	it("ignores files that are not images", () => {
		expect(
			detectProjectIcon(treeOf(["README.md", "package.json", "src/logo.ts"])),
		).toBeNull();
	});

	it("takes a root logo", () => {
		expect(detectProjectIcon(treeOf(["logo.svg"]))).toBe("logo.svg");
	});

	it("prefers svg over png for the same basename", () => {
		expect(detectProjectIcon(treeOf(["logo.png", "logo.svg"]))).toBe(
			"logo.svg",
		);
	});

	it("ranks ico last, because it is usually a 16px favicon", () => {
		expect(detectProjectIcon(treeOf(["favicon.ico", "favicon.png"]))).toBe(
			"favicon.png",
		);
	});

	it("prefers logo over icon over favicon", () => {
		expect(
			detectProjectIcon(treeOf(["favicon.svg", "icon.svg", "logo.svg"])),
		).toBe("logo.svg");
		expect(detectProjectIcon(treeOf(["favicon.svg", "icon.svg"]))).toBe(
			"icon.svg",
		);
	});

	it("prefers the project root over a conventional asset directory", () => {
		expect(detectProjectIcon(treeOf(["public/logo.svg", "logo.png"]))).toBe(
			"logo.png",
		);
	});

	it("searches the conventional asset directories in order", () => {
		expect(
			detectProjectIcon(treeOf(["static/logo.svg", "assets/logo.svg"])),
		).toBe("assets/logo.svg");
		expect(
			detectProjectIcon(treeOf(["assets/logo.svg", ".github/logo.svg"])),
		).toBe(".github/logo.svg");
	});

	it("falls back to a monorepo package when the root has no icon", () => {
		expect(
			detectProjectIcon(treeOf(["packages/ui/logo.svg", "package.json"])),
		).toBe("packages/ui/logo.svg");
	});

	it("prefers the monorepo root icon over any package's", () => {
		expect(
			detectProjectIcon(treeOf(["packages/ui/logo.svg", "logo.png"])),
		).toBe("logo.png");
	});

	it("picks monorepo packages in name order, so the result is stable", () => {
		const paths = ["packages/zebra/logo.svg", "packages/alpha/logo.svg"];
		expect(detectProjectIcon(treeOf(paths))).toBe("packages/alpha/logo.svg");
		expect(detectProjectIcon(treeOf([...paths].reverse()))).toBe(
			"packages/alpha/logo.svg",
		);
	});

	it("searches packages before apps", () => {
		expect(
			detectProjectIcon(treeOf(["apps/web/logo.svg", "packages/ui/logo.svg"])),
		).toBe("packages/ui/logo.svg");
	});

	it("finds an icon nested inside a package's asset directory", () => {
		expect(detectProjectIcon(treeOf(["packages/ui/public/favicon.ico"]))).toBe(
			"packages/ui/public/favicon.ico",
		);
	});

	it("returns a workspace-relative path, never an absolute one", () => {
		const detected = detectProjectIcon(treeOf(["assets/logo.png"]));
		expect(detected).toBe("assets/logo.png");
		expect(detected?.startsWith("/")).toBe(false);
	});
});

describe("projectIconCandidates", () => {
	it("covers every directory, basename and format combination", () => {
		// 5 directories x 3 basenames x 7 formats.
		expect(projectIconCandidates()).toHaveLength(105);
	});

	it("puts the root logo first and keeps every entry relative", () => {
		const candidates = projectIconCandidates();
		expect(candidates[0]).toBe("logo.svg");
		expect(candidates.every((candidate) => !candidate.startsWith("/"))).toBe(
			true,
		);
	});

	it("gives the asset directories the same formats as the root", () => {
		const candidates = projectIconCandidates();
		expect(candidates).toContain("public/favicon.ico");
		expect(candidates).toContain("assets/favicon.ico");
		expect(candidates).toContain("static/favicon.ico");
	});
});

describe("isProjectIconFile", () => {
	it("accepts an image and rejects anything else", () => {
		expect(isProjectIconFile("a/b/logo.png")).toBe(true);
		expect(isProjectIconFile("a/b/notes.md")).toBe(false);
	});
});
