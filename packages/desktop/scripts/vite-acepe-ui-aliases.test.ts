import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { buildAcepeUiResolveAliases } from "./vite-acepe-ui-aliases.js";

const desktopRoot = join(import.meta.dirname, "..");
const uiPackageRoot = join(desktopRoot, "../ui");

describe("buildAcepeUiResolveAliases", () => {
	it("maps @acepe/ui and subpath exports to absolute paths under packages/ui/src", () => {
		const aliases = buildAcepeUiResolveAliases(uiPackageRoot);
		const rootAlias = aliases.find((entry) => entry.find === "@acepe/ui");
		const usageWidgetAlias = aliases.find((entry) => entry.find === "@acepe/ui/usage-widget");

		expect(rootAlias).toBeDefined();
		expect(rootAlias?.replacement).toBe(join(uiPackageRoot, "src/index.ts"));
		expect(existsSync(rootAlias?.replacement ?? "")).toBe(true);

		expect(usageWidgetAlias).toBeDefined();
		expect(usageWidgetAlias?.replacement).toBe(
			join(uiPackageRoot, "src/components/usage-widget/index.ts")
		);
		expect(existsSync(usageWidgetAlias?.replacement ?? "")).toBe(true);
	});

	it("maps string exports such as design-tokens.css directly", () => {
		const aliases = buildAcepeUiResolveAliases(uiPackageRoot);
		const cssAlias = aliases.find((entry) => entry.find === "@acepe/ui/design-tokens.css");

		expect(cssAlias).toBeDefined();
		expect(cssAlias?.replacement).toBe(join(uiPackageRoot, "src/lib/design-tokens.css"));
		expect(existsSync(cssAlias?.replacement ?? "")).toBe(true);
	});

	it("sorts aliases longest-key-first so subpaths win over the root entry", () => {
		const aliases = buildAcepeUiResolveAliases(uiPackageRoot);
		const rootIndex = aliases.findIndex((entry) => entry.find === "@acepe/ui");
		const usageWidgetIndex = aliases.findIndex((entry) => entry.find === "@acepe/ui/usage-widget");

		expect(rootIndex).toBeGreaterThanOrEqual(0);
		expect(usageWidgetIndex).toBeGreaterThanOrEqual(0);
		expect(usageWidgetIndex).toBeLessThan(rootIndex);
	});

	it("produces one alias per package.json export key", () => {
		const packageJson = JSON.parse(readFileSync(join(uiPackageRoot, "package.json"), "utf8")) as {
			exports: Record<string, unknown>;
		};
		const aliases = buildAcepeUiResolveAliases(uiPackageRoot);

		expect(aliases.length).toBe(Object.keys(packageJson.exports).length);
	});

	it("includes node_modules symlink root alias when desktopPackageRoot is provided", () => {
		const aliases = buildAcepeUiResolveAliases(uiPackageRoot, {
			desktopPackageRoot: desktopRoot,
		});
		const nodeModulesAlias = aliases.find(
			(entry) => entry.find === join(desktopRoot, "node_modules/@acepe/ui")
		);

		expect(nodeModulesAlias).toBeDefined();
		expect(nodeModulesAlias?.replacement).toBe(uiPackageRoot);
	});
});
