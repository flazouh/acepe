import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

function read(relativePath: string): string {
	return readFileSync(resolve(import.meta.dir, relativePath), "utf8");
}

describe("desktop layering contract", () => {
	it("defines named desktop app layer tokens", () => {
		const appCssSource = read("../app.css");

		expect(appCssSource).toContain("--app-spotlight-z: 9995;");
		expect(appCssSource).toContain("--app-modal-z: 9997;");
		expect(appCssSource).toContain("--app-elevated-z: 9998;");
		expect(appCssSource).toContain("--overlay-z: var(--app-elevated-z);");
		expect(appCssSource).toContain("--app-blocking-z: 9999;");
	});

	it("routes remaining high-z desktop overlays through named layer tokens", () => {
		const mainAppViewSource = read("components/main-app-view.svelte");
		const fileExplorerSource = read(
			"acp/components/file-explorer-modal/file-explorer-modal.svelte"
		);
		const embeddedModalShellSource = read("components/ui/embedded-modal-shell.svelte");
		const designSystemShowcaseSource = read("components/dev/design-system-showcase.svelte");
		const changelogModalSource = read("components/changelog-modal/changelog-modal.svelte");
		const updateModalSource = read("components/update-modal/update-modal.svelte");

		expect(mainAppViewSource).toContain("z-[9997]");
		expect(mainAppViewSource).toContain("z-[9998]");
		expect(mainAppViewSource).toContain("z-[9999]");
		expect(fileExplorerSource).toContain("z-[var(--app-spotlight-z)]");
		expect(embeddedModalShellSource).toContain("z-[var(--app-modal-z)]");
		expect(designSystemShowcaseSource).toContain("z-[9997]");
		expect(changelogModalSource).toContain("z-[var(--app-elevated-z)]");
		expect(updateModalSource).toContain("z-[var(--app-blocking-z)]");
	});
});