import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = join(import.meta.dirname, "check-transcript-virtualizer-deps.ts");
const tempRoots: string[] = [];

function createPackageWithAcpSource(source: string): string {
	const root = join(tmpdir(), `acepe-virtualizer-check-${crypto.randomUUID()}`);
	tempRoots.push(root);
	mkdirSync(join(root, "src", "lib", "acp"), { recursive: true });
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			dependencies: {
				"@tanstack/svelte-virtual": "^3.13.19",
			},
		})
	);
	writeFileSync(join(root, "src", "lib", "acp", "bad.ts"), source);
	return root;
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("check-transcript-virtualizer-deps", () => {
	it("rejects dynamic virtua imports in ACP source", () => {
		const root = createPackageWithAcpSource('await import("virtua");\n');

		const result = spawnSync(process.execPath, [scriptPath], {
			cwd: root,
			encoding: "utf8",
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Transcript virtualization must use TanStack Virtual");
		expect(result.stderr).toContain("src/lib/acp/bad.ts");
	});
});
