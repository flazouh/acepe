import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * @param {string} exportKey
 * @returns {string}
 */
function exportKeyToAliasFind(exportKey) {
	if (exportKey === ".") {
		return "@acepe/ui";
	}
	if (exportKey.startsWith("./")) {
		return `@acepe/ui${exportKey.slice(1)}`;
	}
	throw new Error(`Unexpected @acepe/ui export key: ${exportKey}`);
}

/**
 * @param {unknown} exportValue
 * @param {string} uiPackageRoot
 * @returns {string}
 */
function resolveExportTarget(exportValue, uiPackageRoot) {
	if (typeof exportValue === "string") {
		return resolve(uiPackageRoot, exportValue);
	}
	if (typeof exportValue === "object" && exportValue !== null) {
		const conditions = /** @type {Record<string, string>} */ (exportValue);
		const target = conditions.svelte ?? conditions.default;
		if (typeof target === "string") {
			return resolve(uiPackageRoot, target);
		}
	}
	throw new Error(`Unable to resolve @acepe/ui export target: ${JSON.stringify(exportValue)}`);
}

/**
 * Build Vite resolve.alias entries from packages/ui/package.json exports so every
 * public @acepe/ui import resolves to a single canonical file under packages/ui/.
 *
 * @param {string} uiPackageRoot Absolute path to packages/ui
 * @param {{ desktopPackageRoot?: string }} [options]
 * @returns {ReadonlyArray<{ find: string; replacement: string }>}
 */
export function buildAcepeUiResolveAliases(uiPackageRoot, options = {}) {
	const packageJsonPath = join(uiPackageRoot, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	const exportsMap = packageJson.exports ?? {};

	const aliases = Object.entries(exportsMap).map(([exportKey, exportValue]) => ({
		find: exportKeyToAliasFind(exportKey),
		replacement: resolveExportTarget(exportValue, uiPackageRoot),
	}));

	const desktopPackageRoot = options.desktopPackageRoot;
	if (typeof desktopPackageRoot === "string" && desktopPackageRoot.length > 0) {
		aliases.push({
			find: join(desktopPackageRoot, "node_modules/@acepe/ui"),
			replacement: uiPackageRoot,
		});
	}

	aliases.sort((left, right) => right.find.length - left.find.length);
	return aliases;
}
