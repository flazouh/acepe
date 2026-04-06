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
const websiteLogoPath = resolve(import.meta.dir, "../../website/src/lib/assets/logo.svg");
const websiteFaviconPath = resolve(import.meta.dir, "../../website/src/lib/assets/favicon.svg");
const websiteLayoutPath = resolve(import.meta.dir, "../../website/src/routes/+layout.svelte");
const websiteLayoutCssPath = resolve(import.meta.dir, "../../website/src/routes/layout.css");
const websiteHeaderPath = resolve(
	import.meta.dir,
	"../../website/src/lib/components/header.svelte"
);
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
		expect(assetSource).toContain("pattern0_62_9");
		expect(assetSource).toContain(
			'transform="matrix(0.00198783 0 0 0.00198679 -0.0987395 -0.0326784)"'
		);
		expect(assetSource).not.toContain('rx="28"');
		expect(assetSource).not.toContain("pattern0_52_7");
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

	it("keeps website-visible branding backgroundless while preserving the favicon asset", () => {
		expect(existsSync(websiteLogoPath)).toBe(true);
		expect(existsSync(websiteFaviconPath)).toBe(true);
		expect(existsSync(websiteLayoutPath)).toBe(true);
		expect(existsSync(websiteLayoutCssPath)).toBe(true);
		expect(existsSync(websiteHeaderPath)).toBe(true);
		expect(existsSync(websiteHomePath)).toBe(true);
		expect(existsSync(websiteDownloadPath)).toBe(true);
		expect(existsSync(websitePricingPath)).toBe(true);
		expect(existsSync(websiteLoginPath)).toBe(true);
		if (
			!existsSync(websiteLogoPath) ||
			!existsSync(websiteFaviconPath) ||
			!existsSync(websiteLayoutPath) ||
			!existsSync(websiteLayoutCssPath) ||
			!existsSync(websiteHeaderPath) ||
			!existsSync(websiteHomePath) ||
			!existsSync(websiteDownloadPath) ||
			!existsSync(websitePricingPath) ||
			!existsSync(websiteLoginPath)
		)
			return;

		const websiteLogoSource = readFileSync(websiteLogoPath, "utf8");
		const websiteFaviconSource = readFileSync(websiteFaviconPath, "utf8");
		const websiteLayoutSource = readFileSync(websiteLayoutPath, "utf8");
		const websiteLayoutCssSource = readFileSync(websiteLayoutCssPath, "utf8");
		const websiteHeaderSource = readFileSync(websiteHeaderPath, "utf8");
		const websiteHomeSource = readFileSync(websiteHomePath, "utf8");
		const websiteDownloadSource = readFileSync(websiteDownloadPath, "utf8");
		const websitePricingSource = readFileSync(websitePricingPath, "utf8");
		const websiteLoginSource = readFileSync(websiteLoginPath, "utf8");
		const sharedLogoPngDimensions = getEmbeddedPngDimensions(readFileSync(sharedLogoPath, "utf8"));
		const websiteLogoPngDimensions = getEmbeddedPngDimensions(websiteLogoSource);

		expect(websiteLogoSource).toContain('fill="#000000"');
		expect(websiteLogoSource).toContain('mask="url(#mark-mask)"');
		expect(websiteLogoSource).not.toContain('rx="26"');
		expect(websiteLogoSource).not.toContain('fill="url(#pattern0_62_9)"');
		expect(websiteFaviconSource).toContain('rx="26"');
		expect(websiteLayoutSource).toContain("import logo from '$lib/assets/favicon.svg';");
		expect(websiteLayoutCssSource).toContain("@custom-variant dark (&:is([data-theme='dark'] *));");
		expect(websiteHeaderSource).toContain('import logoForLight from "$lib/assets/logo.svg";');
		expect(websiteHeaderSource).toContain('import logoForDark from "$lib/assets/logo-light-bg.svg";');
		expect(websiteHeaderSource).toContain('class="h-6 w-6 dark:hidden"');
		expect(websiteHeaderSource).toContain('class="hidden h-6 w-6 dark:block"');
		expect(websiteHomeSource).toContain('import logoForLight from "$lib/assets/logo.svg";');
		expect(websiteHomeSource).toContain('import logoForDark from "$lib/assets/logo-light-bg.svg";');
		expect(websiteHomeSource).toContain('class="h-6 w-6 dark:hidden"');
		expect(websiteHomeSource).toContain('class="hidden h-6 w-6 dark:block"');
		expect(websiteDownloadSource).toContain('import logoForLight from "$lib/assets/logo.svg";');
		expect(websiteDownloadSource).toContain('import logoForDark from "$lib/assets/logo-light-bg.svg";');
		expect(websiteDownloadSource).toContain('class="h-6 w-6 dark:hidden"');
		expect(websiteDownloadSource).toContain('class="hidden h-6 w-6 dark:block"');
		expect(websitePricingSource).toContain('import logoForLight from "$lib/assets/logo.svg";');
		expect(websitePricingSource).toContain('import logoForDark from "$lib/assets/logo-light-bg.svg";');
		expect(websitePricingSource).toContain('class="h-6 w-6 dark:hidden"');
		expect(websitePricingSource).toContain('class="hidden h-6 w-6 dark:block"');
		expect(websiteLoginSource).toContain('import logoForLight from "$lib/assets/logo.svg";');
		expect(websiteLoginSource).toContain('import logoForDark from "$lib/assets/logo-light-bg.svg";');
		expect(websiteLoginSource).toContain('class="h-7 w-7 dark:hidden"');
		expect(websiteLoginSource).toContain('class="hidden h-7 w-7 dark:block"');
		expect(websiteLoginSource).not.toContain('<rect x="5" y="5" width="6" height="22"');
		expect(sharedLogoPngDimensions).not.toBeNull();
		expect(websiteLogoPngDimensions).not.toBeNull();
		if (sharedLogoPngDimensions !== null && websiteLogoPngDimensions !== null) {
			expect(websiteLogoPngDimensions.width).toBeGreaterThanOrEqual(sharedLogoPngDimensions.width);
			expect(websiteLogoPngDimensions.height).toBeGreaterThanOrEqual(
				sharedLogoPngDimensions.height
			);
		}
	});

	it("uses the shared logo asset as the icon generation source of truth", () => {
		expect(existsSync(iconScriptPath)).toBe(true);
		if (!existsSync(iconScriptPath)) return;

		const scriptSource = readFileSync(iconScriptPath, "utf8");

		expect(scriptSource).toContain('SOURCE_LOGO="$ASSETS_DIR/logo.svg"');
		expect(scriptSource).toContain('magick "$SOURCE_LOGO"');
		expect(scriptSource).toContain('DARK_LOGO_BACKGROUND="#1A1A1A"');
		expect(scriptSource).toContain('DARK_LOGO_FOREGROUND="#EBCB8B"');
		expect(scriptSource).toContain('WEBSITE_LOGO_FOREGROUND="#000000"');
		expect(scriptSource).toContain('WEBSITE_LOGO_DARK_FOREGROUND="#EBCB8B"');
		expect(scriptSource).toContain('WEBSITE_LOGO_MASK_PNG="/tmp/acepe_website_logo_mask.png"');
		expect(scriptSource).toContain('cp "$SOURCE_LOGO" "$WEBSITE_STATIC/favicon.svg"');
		expect(scriptSource).toContain('cat > "$WEBSITE_ASSETS/logo.svg" <<EOF');
		expect(scriptSource).toContain('cat > "$WEBSITE_ASSETS/logo-light.svg" <<EOF');
		expect(scriptSource).toContain('base64 < "$LOGO_DARK_MASK_PNG"');
		expect(scriptSource).not.toContain("resize 280x280");
		expect(scriptSource).not.toContain('cat > "$ASSETS_DIR/logo.svg"');
		expect(scriptSource).not.toContain('cp "$SOURCE_LOGO" "$SOURCE_LOGO_DARK"');
		expect(scriptSource).not.toContain("roundrectangle 100,100 923,923");
	});
});
