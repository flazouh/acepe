import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

type PackageJson = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

function readPackageJson(relativePath: string): PackageJson {
	const packageJsonPath = resolve(import.meta.dir, relativePath);
	return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

function readFile(relativePath: string): string {
	return readFileSync(resolve(import.meta.dir, relativePath), "utf8");
}

describe("workspace dependency alignment", () => {
	it("keeps shared dependency versions aligned across workspace packages", () => {
		const desktopPackageJson = readPackageJson("../package.json");
		const websitePackageJson = readPackageJson("../../website/package.json");
		const uiPackageJson = readPackageJson("../../ui/package.json");
		const analyticsPackageJson = readPackageJson("../../analytics/package.json");

		expect(analyticsPackageJson.devDependencies?.typescript).toBe("^5.9.3");
		expect(desktopPackageJson.dependencies?.["@lucide/svelte"]).toBe("^0.562.0");
		expect(desktopPackageJson.dependencies?.["phosphor-svelte"]).toBe("^3.1.0");
		expect(desktopPackageJson.devDependencies?.["@sveltejs/kit"]).toBe("^2.49.1");
		expect(desktopPackageJson.devDependencies?.["@sveltejs/vite-plugin-svelte"]).toBe(
			"^6.2.1",
		);
		expect(desktopPackageJson.devDependencies?.shiki).toBe("^3.22.0");
		expect(desktopPackageJson.devDependencies?.svelte).toBe("^5.45.6");
		expect(desktopPackageJson.devDependencies?.typescript).toBe("^5.9.3");
		expect(desktopPackageJson.devDependencies?.vite).toBe("^7.2.6");
		expect(uiPackageJson.dependencies?.["@lucide/svelte"]).toBe("^0.562.0");
		expect(uiPackageJson.dependencies?.["phosphor-svelte"]).toBe("^3.1.0");
		expect(websitePackageJson.devDependencies?.["@lucide/svelte"]).toBe("^0.562.0");
	});

	it("keeps the Bun lockfile workspace selectors aligned with the package manifests", () => {
		const bunLockSource = readFile("../../../bun.lock");

		expect(bunLockSource).toContain('"packages/analytics": {');
		expect(bunLockSource).toContain('"typescript": "^5.9.3"');
		expect(bunLockSource).toContain('"@sveltejs/kit": "^2.49.1"');
		expect(bunLockSource).toContain('"@sveltejs/vite-plugin-svelte": "^6.2.1"');
		expect(bunLockSource).toContain('"shiki": "^3.22.0"');
		expect(bunLockSource).toContain('"svelte": "^5.45.6"');
		expect(bunLockSource).toContain('"vite": "^7.2.6"');
		expect(bunLockSource).toContain('"@lucide/svelte": "^0.562.0"');
		expect(bunLockSource).toContain('"phosphor-svelte": "^3.1.0"');
	});
});
