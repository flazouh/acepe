/**
 * Machine-readable forbidden import rules for @acepe/ui.
 * Human documentation: .github/skills/extract-to-ui-package/references/forbidden-imports.md
 */

export interface ForbiddenImportRule {
	id: string;
	description: string;
	matches: (specifier: string) => boolean;
}

export const UI_PACKAGE_FORBIDDEN_IMPORT_RULES: readonly ForbiddenImportRule[] = [
	{
		id: "tauri-apps",
		description: "Tauri runtime APIs",
		matches: (specifier) => specifier.startsWith("@tauri-apps/"),
	},
	{
		id: "desktop-lib-store",
		description: "Desktop store alias",
		matches: (specifier) =>
			specifier === "$lib/store" || specifier.startsWith("$lib/store/"),
	},
	{
		id: "desktop-lib-services",
		description: "Desktop services alias",
		matches: (specifier) =>
			specifier === "$lib/services" || specifier.startsWith("$lib/services/"),
	},
	{
		id: "desktop-lib-paraglide",
		description: "Desktop i18n alias",
		matches: (specifier) =>
			specifier === "$lib/paraglide" || specifier.startsWith("$lib/paraglide/"),
	},
	{
		id: "ui-lib-store",
		description: "UI package store-like paths",
		matches: (specifier) =>
			specifier.includes("/lib/store/") ||
			specifier.endsWith("/lib/store") ||
			specifier === "$lib/store" ||
			specifier.startsWith("$lib/store/"),
	},
	{
		id: "paraglide",
		description: "Paraglide i18n modules",
		matches: (specifier) =>
			specifier.includes("/paraglide/") || specifier.endsWith("/paraglide"),
	},
	{
		id: "acepe-desktop",
		description: "Desktop package imports",
		matches: (specifier) =>
			specifier === "@acepe/desktop" || specifier.startsWith("@acepe/desktop/"),
	},
	{
		id: "packages-desktop-path",
		description: "Relative imports into packages/desktop",
		matches: (specifier) => specifier.includes("packages/desktop"),
	},
	{
		id: "svelte-sonner",
		description: "Desktop toast runtime",
		matches: (specifier) =>
			specifier === "svelte-sonner" || specifier.startsWith("svelte-sonner/"),
	},
];

export function findForbiddenImportRule(
	specifier: string
): ForbiddenImportRule | null {
	for (const rule of UI_PACKAGE_FORBIDDEN_IMPORT_RULES) {
		if (rule.matches(specifier)) {
			return rule;
		}
	}
	return null;
}
