import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type DependencyMap = Record<string, string>;

interface PackageManifest {
	dependencies?: DependencyMap;
	devDependencies?: DependencyMap;
}

function readManifest(relativePath: string): PackageManifest {
	return JSON.parse(
		readFileSync(resolve(import.meta.dir, "..", "..", relativePath), "utf8"),
	) as PackageManifest;
}

function hasDependency(manifest: PackageManifest, dependencyName: string): boolean {
	const dependencies = manifest.dependencies;
	if (dependencies && dependencyName in dependencies) {
		return true;
	}

	const devDependencies = manifest.devDependencies;
	if (devDependencies && dependencyName in devDependencies) {
		return true;
	}

	return false;
}

describe("workspace dependency cleanup contract", () => {
	it("removes only the dependencies confirmed unused by source and config search", () => {
		const rootManifest = readManifest("package.json");
		const desktopManifest = readManifest("packages/desktop/package.json");
		const websiteManifest = readManifest("packages/website/package.json");
		const uiManifest = readManifest("packages/ui/package.json");

		expect(hasDependency(rootManifest, "phosphor-icons-svelte")).toBe(false);

		expect(hasDependency(desktopManifest, "lucide-svelte")).toBe(false);
		expect(hasDependency(desktopManifest, "class-variance-authority")).toBe(false);
		expect(hasDependency(desktopManifest, "autoprefixer")).toBe(false);
		expect(hasDependency(desktopManifest, "postcss")).toBe(false);
		expect(hasDependency(desktopManifest, "shadcn-svelte")).toBe(false);

		expect(hasDependency(websiteManifest, "bcrypt")).toBe(false);
		expect(hasDependency(websiteManifest, "@types/bcrypt")).toBe(false);
		expect(hasDependency(websiteManifest, "@types/pg")).toBe(false);
		expect(hasDependency(websiteManifest, "@sveltejs/adapter-auto")).toBe(false);
		expect(hasDependency(websiteManifest, "@internationalized/date")).toBe(false);

		expect(hasDependency(uiManifest, "class-variance-authority")).toBe(false);
		expect(hasDependency(uiManifest, "@tanstack/svelte-query")).toBe(false);
		expect(hasDependency(uiManifest, "@internationalized/date")).toBe(false);
	});

	it("keeps dependencies that are still imported by the app", () => {
		const desktopManifest = readManifest("packages/desktop/package.json");
		const websiteManifest = readManifest("packages/website/package.json");

		expect(hasDependency(desktopManifest, "@internationalized/date")).toBe(true);
		expect(hasDependency(desktopManifest, "@tanstack/table-core")).toBe(true);
		expect(hasDependency(desktopManifest, "embla-carousel-svelte")).toBe(true);
		expect(hasDependency(desktopManifest, "layerchart")).toBe(true);
		expect(hasDependency(desktopManifest, "mode-watcher")).toBe(true);
		expect(hasDependency(desktopManifest, "svelte-sonner")).toBe(true);
		expect(hasDependency(desktopManifest, "virtua")).toBe(true);

		expect(hasDependency(websiteManifest, "nanoid")).toBe(true);
	});
});
