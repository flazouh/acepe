import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = join(import.meta.dirname, "check-rust-owned-transcript-viewport.ts");
const tempRoots: string[] = [];

function createPackageWithAgentPanelSource(relativeFilePath: string, source: string): string {
	const root = join(tmpdir(), `acepe-rust-viewport-check-${crypto.randomUUID()}`);
	tempRoots.push(root);
	const fullFilePath = join(
		root,
		"src",
		"lib",
		"acp",
		"components",
		"agent-panel",
		relativeFilePath
	);
	mkdirSync(join(fullFilePath, ".."), { recursive: true });
	writeFileSync(fullFilePath, source);
	return root;
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("check-rust-owned-transcript-viewport", () => {
	it("rejects old transcript viewport authority files", () => {
		const root = createPackageWithAgentPanelSource(
			"logic/transcript-viewport-controller.ts",
			"export const oldAuthority = true;\n"
		);

		const result = spawnSync(process.execPath, [scriptPath], {
			cwd: root,
			encoding: "utf8",
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Rust-owned");
		expect(result.stderr).toContain("transcript-viewport-controller.ts");
	});

	it("rejects TanStack imports in the main transcript viewport path", () => {
		const root = createPackageWithAgentPanelSource(
			"components/scene-content-viewport.svelte",
			'import { createVirtualizer } from "@tanstack/svelte-virtual";\n'
		);

		const result = spawnSync(process.execPath, [scriptPath], {
			cwd: root,
			encoding: "utf8",
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("forbidden viewport authority import");
	});
});
