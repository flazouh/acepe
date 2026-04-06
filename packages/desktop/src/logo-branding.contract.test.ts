import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const logoComponentPath = resolve(import.meta.dir, "./lib/components/logo.svelte");
const sidebarHeaderLogoPath = resolve(
	import.meta.dir,
	"./lib/components/sidebar-header-logo.svelte"
);
const sharedLogoPath = resolve(import.meta.dir, "../../../assets/logo.svg");
const sharedDarkLogoPath = resolve(import.meta.dir, "../../../assets/logo-dark.svg");
const iconScriptPath = resolve(import.meta.dir, "../scripts/generate-icons.sh");

// Website paths
const websiteFaviconAssetPath = resolve(
	import.meta.dir,
	"../../website/src/lib/assets/favicon.svg"
);
const websiteLogoComponentPath = resolve(
	import.meta.dir,
	"../../website/src/lib/components/logo.svelte"
);
const websiteHeaderPath = resolve(
	import.meta.dir,
	"../../website/src/lib/components/header.svelte"
);
const websiteLayoutPath = resolve(import.meta.dir, "../../website/src/routes/+layout.svelte");
const websiteLayoutCssPath = resolve(import.meta.dir, "../../website/src/routes/layout.css");
const websiteHomePath = resolve(import.meta.dir, "../../website/src/routes/+page.svelte");
const websiteDownloadPath = resolve(
	import.meta.dir,
	"../../website/src/routes/download/+page.svelte"
);
const websitePricingPath = resolve(
	import.meta.dir,
	"../../website/src/routes/pricing/+page.svelte"
);
const websiteLoginPath = resolve(import.meta.dir, "../../website/src/routes/login/+page.svelte");

// Tauri config and meta paths
const tauriConfPath = resolve(import.meta.dir, "../src-tauri/tauri.conf.json");
const desktopAppHtmlPath = resolve(import.meta.dir, "./app.html");
const websiteAppHtmlPath = resolve(import.meta.dir, "../../website/src/app.html");
const webmanifestPath = resolve(import.meta.dir, "../../website/static/site.webmanifest");
const jsonLdPath = resolve(
	import.meta.dir,
	"../../website/src/lib/components/seo/json-ld.svelte"
);
const androidBgPath = resolve(
	import.meta.dir,
	"../src-tauri/icons/android/values/ic_launcher_background.xml"
);

// Desktop component paths for logo imports
const updatePagePath = resolve(
	import.meta.dir,
	"./lib/components/update-available/update-available-page.svelte"
);
const translationBrandingPath = resolve(
	import.meta.dir,
	"./lib/i18n/components/translation-branding.svelte"
);
const welcomeScreenPath = resolve(
	import.meta.dir,
	"./lib/acp/components/welcome-screen/welcome-screen.svelte"
);

function getEmbeddedPngDimensions(svgSource: string): { width: number; height: number } | null {
	const match = svgSource.match(/data:image\/png;base64,([^\"]+)/);
	if (match === null) {
		return null;
	}

	const pngBuffer = Buffer.from(match[1], "base64");

	return {
		width: pngBuffer.readUInt32BE(16),
		height: pngBuffer.readUInt32BE(20),
	};
}

describe("desktop logo branding", () => {
	it("renders the shared document logo asset instead of the legacy inline mark", () => {
		expect(existsSync(logoComponentPath)).toBe(true);
		expect(existsSync(sharedLogoPath)).toBe(true);
		if (!existsSync(logoComponentPath) || !existsSync(sharedLogoPath)) return;

		const componentSource = readFileSync(logoComponentPath, "utf8");
		const sidebarSource = readFileSync(sidebarHeaderLogoPath, "utf8");
		const assetSource = readFileSync(sharedLogoPath, "utf8");

		expect(componentSource).toContain('import logo from "../../../../../assets/logo.svg?url";');
		expect(componentSource).toContain("<img");
		expect(componentSource).toContain("src={logo}");
		expect(componentSource).not.toContain("<svg");
		expect(sidebarSource).toContain('import Logo from "$lib/components/logo.svelte";');
		expect(sidebarSource).toContain('<Logo class="h-6 w-6" />');
		expect(sidebarSource).not.toContain("Acepe Logo - L4-V2");
		expect(assetSource).toContain('viewBox="0 0 140 140"');
		expect(assetSource).toContain('rx="26"');
		expect(assetSource).toContain("mark-mask");
		expect(assetSource).toContain("bgGrad");
		expect(assetSource).toContain("#99FFE4");
		expect(assetSource).toContain("#FFC799");
		expect(assetSource).not.toContain('rx="28"');
		expect(assetSource).not.toContain("Three bars");
	});

	it("provides a dedicated gold-on-dark logo variant", () => {
		expect(existsSync(sharedDarkLogoPath)).toBe(true);
		if (!existsSync(sharedDarkLogoPath)) return;

		const darkAssetSource = readFileSync(sharedDarkLogoPath, "utf8");

		expect(darkAssetSource).toContain('fill="#1A1A1A"');
		expect(darkAssetSource).toContain('fill="#EBCB8B"');
		expect(darkAssetSource).toContain('mask="url(#mark-mask)"');
		expect(darkAssetSource).toContain("data:image/png;base64,");
		expect(darkAssetSource).not.toContain('fill="url(#pattern0_62_9)"');
	});

	it("centralizes website branding through a single Logo component using favicon.svg", () => {
		expect(existsSync(websiteFaviconAssetPath)).toBe(true);
		expect(existsSync(websiteLogoComponentPath)).toBe(true);
		expect(existsSync(websiteHeaderPath)).toBe(true);
		expect(existsSync(websiteLayoutPath)).toBe(true);
		expect(existsSync(websiteLayoutCssPath)).toBe(true);
		expect(existsSync(websiteHomePath)).toBe(true);
		expect(existsSync(websiteDownloadPath)).toBe(true);
		expect(existsSync(websitePricingPath)).toBe(true);
		expect(existsSync(websiteLoginPath)).toBe(true);
		if (
			!existsSync(websiteFaviconAssetPath) ||
			!existsSync(websiteLogoComponentPath) ||
			!existsSync(websiteHeaderPath) ||
			!existsSync(websiteLayoutPath) ||
			!existsSync(websiteLayoutCssPath) ||
			!existsSync(websiteHomePath) ||
			!existsSync(websiteDownloadPath) ||
			!existsSync(websitePricingPath) ||
			!existsSync(websiteLoginPath)
		)
			return;

		const websiteFaviconSource = readFileSync(websiteFaviconAssetPath, "utf8");
		const websiteLogoSource = readFileSync(websiteLogoComponentPath, "utf8");
		const websiteHeaderSource = readFileSync(websiteHeaderPath, "utf8");
		const websiteLayoutSource = readFileSync(websiteLayoutPath, "utf8");
		const websiteLayoutCssSource = readFileSync(websiteLayoutCssPath, "utf8");
		const websiteHomeSource = readFileSync(websiteHomePath, "utf8");
		const websiteDownloadSource = readFileSync(websiteDownloadPath, "utf8");
		const websitePricingSource = readFileSync(websitePricingPath, "utf8");
		const websiteLoginSource = readFileSync(websiteLoginPath, "utf8");

		// The favicon.svg is the full branded icon with rx="26" rounded rect
		expect(websiteFaviconSource).toContain('rx="26"');

		// The Logo component imports favicon.svg -- single source of truth for the website
		expect(websiteLogoSource).toContain('import logo from "$lib/assets/favicon.svg"');
		expect(websiteLogoSource).toContain("<img");
		expect(websiteLogoSource).not.toContain("dark:hidden");
		expect(websiteLogoSource).not.toContain("dark:block");

		// Dynamic favicon link in layout
		expect(websiteLayoutSource).toContain("import logo from '$lib/assets/favicon.svg';");
		expect(websiteLayoutCssSource).toContain(
			"@custom-variant dark (&:is([data-theme='dark'] *));"
		);

		// All pages use the centralized Logo component (not direct asset imports)
		expect(websiteHeaderSource).toContain('import Logo from "$lib/components/logo.svelte"');
		expect(websiteHeaderSource).not.toContain("logoForLight");
		expect(websiteHeaderSource).not.toContain("logoForDark");
		expect(websiteHeaderSource).not.toContain("logo-light-bg");

		expect(websiteHomeSource).toContain('import Logo from "$lib/components/logo.svelte"');
		expect(websiteHomeSource).not.toContain("logoForLight");
		expect(websiteHomeSource).not.toContain("logo-light-bg");

		expect(websiteDownloadSource).toContain('import Logo from "$lib/components/logo.svelte"');
		expect(websiteDownloadSource).not.toContain("logoForLight");
		expect(websiteDownloadSource).not.toContain("logo-light-bg");

		expect(websitePricingSource).toContain('import Logo from "$lib/components/logo.svelte"');
		expect(websitePricingSource).not.toContain("logoForLight");
		expect(websitePricingSource).not.toContain("logo-light-bg");

		expect(websiteLoginSource).toContain('import Logo from "$lib/components/logo.svelte"');
		expect(websiteLoginSource).not.toContain("logoForLight");
		expect(websiteLoginSource).not.toContain("logo-light-bg");
	});

	it("uses the shared logo asset as the icon generation source of truth", () => {
		expect(existsSync(iconScriptPath)).toBe(true);
		if (!existsSync(iconScriptPath)) return;

		const scriptSource = readFileSync(iconScriptPath, "utf8");

		// Source logo and color constants
		expect(scriptSource).toContain('SOURCE_LOGO="$ASSETS_DIR/logo.svg"');
		expect(scriptSource).toContain('LOGO_SOURCE_BACKGROUND="#F1EEE6"');
		expect(scriptSource).toContain('DARK_LOGO_BACKGROUND="#1A1A1A"');
		expect(scriptSource).toContain('DARK_LOGO_FOREGROUND="#EBCB8B"');

		// Core pipeline: render SVG -> tauri icon -> dark variant -> website assets
		expect(scriptSource).toContain('magick "$SOURCE_LOGO"');
		expect(scriptSource).toContain('cp "$SOURCE_LOGO" "$WEBSITE_STATIC/favicon.svg"');
		expect(scriptSource).toContain('cp "$SOURCE_LOGO" "$WEBSITE_ASSETS/favicon.svg"');
		expect(scriptSource).toContain('base64 < "$LOGO_DARK_MASK_PNG"');

		// Favicon.ico and OG image generation
		expect(scriptSource).toContain("favicon.ico");
		expect(scriptSource).toContain("og-image.png");

		// Android launcher background patch
		expect(scriptSource).toContain("$LOGO_SOURCE_BACKGROUND");
		expect(scriptSource).toContain("ic_launcher_background.xml");

		// Should NOT generate orphan website SVGs
		expect(scriptSource).not.toContain('cat > "$WEBSITE_ASSETS/logo.svg"');
		expect(scriptSource).not.toContain('cat > "$WEBSITE_ASSETS/logo-light.svg"');
		expect(scriptSource).not.toContain("WEBSITE_LOGO_FOREGROUND");
		expect(scriptSource).not.toContain("WEBSITE_LOGO_DARK_FOREGROUND");
		expect(scriptSource).not.toContain("resize 280x280");
		expect(scriptSource).not.toContain('cat > "$ASSETS_DIR/logo.svg"');
		expect(scriptSource).not.toContain("roundrectangle 100,100 923,923");
	});

	it("wires tauri.conf.json icon paths to generated assets", () => {
		expect(existsSync(tauriConfPath)).toBe(true);
		if (!existsSync(tauriConfPath)) return;

		const tauriConf = readFileSync(tauriConfPath, "utf8");

		expect(tauriConf).toContain("icons/32x32.png");
		expect(tauriConf).toContain("icons/128x128.png");
		expect(tauriConf).toContain("icons/128x128@2x.png");
		expect(tauriConf).toContain("icons/icon.icns");
		expect(tauriConf).toContain("icons/icon.ico");
	});

	it("references correct favicon and OG image in meta tags", () => {
		expect(existsSync(desktopAppHtmlPath)).toBe(true);
		expect(existsSync(websiteAppHtmlPath)).toBe(true);
		if (!existsSync(desktopAppHtmlPath) || !existsSync(websiteAppHtmlPath)) return;

		const desktopHtml = readFileSync(desktopAppHtmlPath, "utf8");
		const websiteHtml = readFileSync(websiteAppHtmlPath, "utf8");

		expect(desktopHtml).toContain("favicon.png");
		expect(websiteHtml).toContain("og-image.png");
		expect(websiteHtml).toContain("apple-touch-icon.png");
	});

	it("keeps webmanifest and json-ld in sync with generated assets", () => {
		expect(existsSync(webmanifestPath)).toBe(true);
		expect(existsSync(jsonLdPath)).toBe(true);
		if (!existsSync(webmanifestPath) || !existsSync(jsonLdPath)) return;

		const manifest = readFileSync(webmanifestPath, "utf8");
		const jsonLd = readFileSync(jsonLdPath, "utf8");

		expect(manifest).toContain("favicon-192x192.png");
		expect(manifest).toContain("favicon-512x512.png");
		expect(jsonLd).toContain("favicon-512x512.png");
		expect(jsonLd).toContain("og-image.png");
	});

	it("patches Android launcher background to match brand color", () => {
		if (!existsSync(androidBgPath)) return;

		const androidBg = readFileSync(androidBgPath, "utf8");

		expect(androidBg).toContain("#F1EEE6");
		expect(androidBg).not.toContain("#fff");
	});

	it("imports the shared logo in desktop components that show branding", () => {
		if (!existsSync(updatePagePath)) return;

		const updatePageSource = readFileSync(updatePagePath, "utf8");
		const translationSource = existsSync(translationBrandingPath)
			? readFileSync(translationBrandingPath, "utf8")
			: "";
		const welcomeSource = existsSync(welcomeScreenPath)
			? readFileSync(welcomeScreenPath, "utf8")
			: "";

		expect(updatePageSource).toContain("logo.svg");

		if (translationSource) {
			expect(translationSource).toContain("logo");
		}
		if (welcomeSource) {
			expect(welcomeSource).toContain("logo");
		}
	});
});
