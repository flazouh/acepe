import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { analyzeDeadCode, parseGitPorcelain } from "../find-dead-code.js";

function createFixture(): string {
	return mkdtempSync(join(tmpdir(), "acepe-dead-code-"));
}

function writeFixtureFile(root: string, path: string, content: string): void {
	const absolutePath = join(root, path);
	mkdirSync(join(absolutePath, ".."), { recursive: true });
	writeFileSync(absolutePath, content);
}

function analyzeFixture(root: string) {
	const result = analyzeDeadCode({
		repoRoot: root,
		includeGitStatus: false,
	});
	if (result.isErr()) {
		throw new Error(result.error);
	}
	return result.value;
}

describe("find-dead-code", () => {
	test("keeps package exports and SvelteKit route files rooted", () => {
		const root = createFixture();
		writeFixtureFile(
			root,
			"package.json",
			JSON.stringify({ workspaces: ["packages/*"] })
		);
		writeFixtureFile(
			root,
			"packages/app/package.json",
			JSON.stringify({
				name: "@fixture/app",
				exports: {
					".": "./src/index.ts",
				},
			})
		);
		writeFixtureFile(root, "packages/app/src/index.ts", "export { value } from './live.js';\n");
		writeFixtureFile(root, "packages/app/src/live.ts", "export const value = 1;\n");
		writeFixtureFile(root, "packages/app/src/orphan.ts", "export const orphan = 1;\n");
		writeFixtureFile(root, "packages/app/src/routes/+page.svelte", "<h1>hello</h1>\n");

		const analysis = analyzeFixture(root);
		const strongDead = analysis.candidates
			.filter((candidate) => candidate.classification === "strong-dead")
			.map((candidate) => candidate.path);
		const reachable = analysis.candidates
			.filter((candidate) => candidate.classification === "production-reachable")
			.map((candidate) => candidate.path);

		expect(reachable).toContain("packages/app/src/index.ts");
		expect(reachable).toContain("packages/app/src/live.ts");
		expect(reachable).toContain("packages/app/src/routes/+page.svelte");
		expect(strongDead).toContain("packages/app/src/orphan.ts");

		rmSync(root, { recursive: true, force: true });
	});

	test("keeps Cargo bin paths and Rust module declarations rooted", () => {
		const root = createFixture();
		writeFixtureFile(
			root,
			"packages/desktop/src-tauri/Cargo.toml",
			'[[bin]]\nname = "tool"\npath = "src/bin/tool.rs"\n'
		);
		writeFixtureFile(root, "packages/desktop/src-tauri/src/lib.rs", "mod live;\n");
		writeFixtureFile(root, "packages/desktop/src-tauri/src/live.rs", "pub fn live() {}\n");
		writeFixtureFile(root, "packages/desktop/src-tauri/src/bin/tool.rs", "fn main() {}\n");
		writeFixtureFile(root, "packages/desktop/src-tauri/src/orphan.rs", "pub fn orphan() {}\n");

		const analysis = analyzeFixture(root);
		const strongDead = analysis.candidates
			.filter((candidate) => candidate.classification === "strong-dead")
			.map((candidate) => candidate.path);
		const reachable = analysis.candidates
			.filter((candidate) => candidate.classification === "production-reachable")
			.map((candidate) => candidate.path);

		expect(reachable).toContain("packages/desktop/src-tauri/src/lib.rs");
		expect(reachable).toContain("packages/desktop/src-tauri/src/live.rs");
		expect(reachable).toContain("packages/desktop/src-tauri/src/bin/tool.rs");
		expect(strongDead).toContain("packages/desktop/src-tauri/src/orphan.rs");

		rmSync(root, { recursive: true, force: true });
	});

	test("keeps Svelte markup dynamic import targets reachable", () => {
		const root = createFixture();
		writeFixtureFile(
			root,
			"packages/site/package.json",
			JSON.stringify({ name: "@fixture/site" })
		);
		writeFixtureFile(
			root,
			"packages/site/src/routes/+page.svelte",
			'{#await import("$lib/components/demo.svelte")}loading{/await}\n'
		);
		writeFixtureFile(root, "packages/site/src/lib/components/demo.svelte", "<p>demo</p>\n");
		writeFixtureFile(root, "packages/site/src/lib/components/orphan.svelte", "<p>orphan</p>\n");

		const analysis = analyzeFixture(root);
		const strongDead = analysis.candidates
			.filter((candidate) => candidate.classification === "strong-dead")
			.map((candidate) => candidate.path);
		const reachable = analysis.candidates
			.filter((candidate) => candidate.classification === "production-reachable")
			.map((candidate) => candidate.path);

		expect(reachable).toContain("packages/site/src/lib/components/demo.svelte");
		expect(strongDead).toContain("packages/site/src/lib/components/orphan.svelte");

		rmSync(root, { recursive: true, force: true });
	});

	test("ignores import-like examples inside quoted strings", () => {
		const root = createFixture();
		writeFixtureFile(
			root,
			"packages/app/package.json",
			JSON.stringify({
				name: "@fixture/app",
				exports: {
					".": "./src/index.ts",
				},
			})
		);
		writeFixtureFile(
			root,
			"packages/app/src/index.ts",
			[
				"import { live } from './live.js';",
				"const typeExample = 'import type { Ghost } from \"./ghost.js\";';",
				"const dynamicExample = '{#await import(\"./ghost-demo.svelte\")}loading{/await}';",
				"export { live };",
			].join("\n")
		);
		writeFixtureFile(root, "packages/app/src/live.ts", "export const live = 1;\n");
		writeFixtureFile(root, "packages/app/src/ghost.ts", "export const ghost = 1;\n");
		writeFixtureFile(root, "packages/app/src/ghost-demo.svelte", "<p>ghost</p>\n");

		const analysis = analyzeFixture(root);
		const strongDead = analysis.candidates
			.filter((candidate) => candidate.classification === "strong-dead")
			.map((candidate) => candidate.path);
		const unresolved = analysis.unresolved.map(
			(reference) => `${reference.from} -> ${reference.specifier}`
		);

		expect(strongDead).toContain("packages/app/src/ghost.ts");
		expect(strongDead).toContain("packages/app/src/ghost-demo.svelte");
		expect(unresolved).not.toContain("packages/app/src/index.ts -> ./ghost.js");
		expect(unresolved).not.toContain("packages/app/src/index.ts -> ./ghost-demo.svelte");

		rmSync(root, { recursive: true, force: true });
	});

	test("keeps ambient TypeScript declarations rooted", () => {
		const root = createFixture();
		writeFixtureFile(root, "packages/app/package.json", JSON.stringify({ name: "@fixture/app" }));
		writeFixtureFile(root, "packages/app/src/global.d.ts", "declare module 'fixture-external';\n");
		writeFixtureFile(root, "packages/app/src/orphan.ts", "export const orphan = 1;\n");

		const analysis = analyzeFixture(root);
		const reachable = analysis.candidates
			.filter((candidate) => candidate.classification === "production-reachable")
			.map((candidate) => candidate.path);
		const strongDead = analysis.candidates
			.filter((candidate) => candidate.classification === "strong-dead")
			.map((candidate) => candidate.path);

		expect(reachable).toContain("packages/app/src/global.d.ts");
		expect(strongDead).toContain("packages/app/src/orphan.ts");

		rmSync(root, { recursive: true, force: true });
	});

	test("rejects malformed allowlist classifications", () => {
		const root = createFixture();
		writeFixtureFile(
			root,
			"scripts/dead-code/dead-code-allowlist.json",
			JSON.stringify({
				version: 1,
				entries: [
					{
						path: "packages/app/src/live.ts",
						classification: "static",
						reason: "invalid fixture",
					},
				],
			})
		);
		writeFixtureFile(root, "packages/app/src/live.ts", "export const live = 1;\n");

		const result = analyzeDeadCode({
			repoRoot: root,
			includeGitStatus: false,
		});

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toContain("invalid classification static");
		}

		rmSync(root, { recursive: true, force: true });
	});

	test("parses already-deleted files from git porcelain output", () => {
		const parsed = parseGitPorcelain(
			" D packages/app/src/deleted.ts\nRM packages/app/src/old.ts -> packages/app/src/new.ts\n"
		);
		expect(parsed.map((candidate) => candidate.path)).toEqual([
			"packages/app/src/deleted.ts",
			"packages/app/src/old.ts",
		]);
	});

	test("classifies barrel-export-only files separately from production reachability", () => {
		const root = createFixture();
		writeFixtureFile(
			root,
			"packages/app/package.json",
			JSON.stringify({
				name: "@fixture/app",
				exports: {
					".": "./src/public-api.ts",
				},
			})
		);
		writeFixtureFile(
			root,
			"packages/app/src/public-api.ts",
			"export { panel } from './panel.js';\n"
		);
		writeFixtureFile(root, "packages/app/src/panel.ts", "export const panel = 1;\n");
		writeFixtureFile(
			root,
			"packages/app/src/components/index.ts",
			"export { default as UsedView } from '../used-view.svelte';\nexport { default as OrphanView } from '../orphan-view.svelte';\n"
		);
		writeFixtureFile(root, "packages/app/src/used-view.svelte", "<p>used</p>\n");
		writeFixtureFile(root, "packages/app/src/orphan-view.svelte", "<p>orphan</p>\n");
		writeFixtureFile(
			root,
			"packages/app/src/routes/+page.ts",
			"import { UsedView } from '../components/index.js';\nexport const host = UsedView;\n"
		);
		writeFixtureFile(root, "packages/app/src/unused.ts", "export const unused = 1;\n");

		const analysis = analyzeFixture(root);
		const byPath = new Map(analysis.candidates.map((candidate) => [candidate.path, candidate]));

		expect(byPath.get("packages/app/src/public-api.ts")?.classification).toBe("production-reachable");
		expect(byPath.get("packages/app/src/panel.ts")?.classification).toBe("production-reachable");
		expect(byPath.get("packages/app/src/used-view.svelte")?.classification).toBe("production-reachable");
		expect(byPath.get("packages/app/src/orphan-view.svelte")?.classification).toBe(
			"export-barrel-only"
		);
		expect(byPath.get("packages/app/src/unused.ts")?.classification).toBe("strong-dead");

		rmSync(root, { recursive: true, force: true });
	});

	test("treats named imports through star re-export barrels as production reachable", () => {
		const root = createFixture();
		writeFixtureFile(
			root,
			"packages/app/package.json",
			JSON.stringify({
				name: "@fixture/app",
				exports: {
					".": "./src/public-api.ts",
				},
			})
		);
		writeFixtureFile(
			root,
			"packages/app/src/public-api.ts",
			"export { panel } from './panel.js';\n"
		);
		writeFixtureFile(root, "packages/app/src/panel.ts", "export const panel = 1;\n");
		writeFixtureFile(
			root,
			"packages/app/src/components/index.ts",
			"export { default as UsedView } from '../used-view.svelte';\nexport { default as OrphanView } from '../orphan-view.svelte';\n"
		);
		writeFixtureFile(root, "packages/app/src/used-view.svelte", "<p>used</p>\n");
		writeFixtureFile(root, "packages/app/src/orphan-view.svelte", "<p>orphan</p>\n");
		writeFixtureFile(
			root,
			"packages/app/src/route-host.ts",
			"export * from './components/index.js';\n"
		);
		writeFixtureFile(
			root,
			"packages/app/src/routes/+page.ts",
			"import { UsedView } from '../route-host.js';\nexport const host = UsedView;\n"
		);

		const analysis = analyzeFixture(root);
		const byPath = new Map(analysis.candidates.map((candidate) => [candidate.path, candidate]));

		expect(byPath.get("packages/app/src/used-view.svelte")?.classification).toBe("production-reachable");
		expect(byPath.get("packages/app/src/orphan-view.svelte")?.classification).toBe(
			"export-barrel-only"
		);

		rmSync(root, { recursive: true, force: true });
	});
});
