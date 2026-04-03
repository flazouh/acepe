import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const logoComponentPath = resolve(import.meta.dir, "./lib/components/logo.svelte");
const sidebarHeaderLogoPath = resolve(import.meta.dir, "./lib/components/sidebar-header-logo.svelte");
const sharedLogoPath = resolve(import.meta.dir, "../../../assets/logo.svg");
const iconScriptPath = resolve(import.meta.dir, "../scripts/generate-icons.sh");

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
		expect(sidebarSource).toContain("<Logo class=\"h-6 w-6\" />");
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

	it("uses the shared logo asset as the icon generation source of truth", () => {
		expect(existsSync(iconScriptPath)).toBe(true);
		if (!existsSync(iconScriptPath)) return;

		const scriptSource = readFileSync(iconScriptPath, "utf8");

		expect(scriptSource).toContain('SOURCE_LOGO="$ASSETS_DIR/logo.svg"');
		expect(scriptSource).toContain('magick "$SOURCE_LOGO"');
		expect(scriptSource).not.toContain('cat > "$ASSETS_DIR/logo.svg"');
		expect(scriptSource).not.toContain('roundrectangle 100,100 923,923');
	});
});