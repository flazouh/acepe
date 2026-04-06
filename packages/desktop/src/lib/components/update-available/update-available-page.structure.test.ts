import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./update-available-page.svelte"), "utf8");

describe("update available page structure", () => {
	it("uses a denser compact full-width segmented progress bar", () => {
		expect(source).toContain("const UPDATE_PROGRESS_SEGMENT_COUNT = 96;");
		expect(source).not.toContain("const UPDATE_PROGRESS_SEGMENT_COUNT = 72;");
		expect(source).toContain("compact={true}");
		expect(source).toContain("fillWidth={true}");
	});

	it("keeps the update card layout compact", () => {
		expect(source).toContain('max-w-2xl');
		expect(source).toContain('px-5 py-8');
		expect(source).toContain('rounded-xl');
		expect(source).toContain('gap-3 p-5 pb-4');
		expect(source).toContain('gap-3.5');
		expect(source).not.toContain('max-w-3xl');
		expect(source).not.toContain('px-6 py-12');
		expect(source).not.toContain('rounded-2xl');
		expect(source).not.toContain('gap-5');
	});

	it("only shows install copy when the install phase has actually started", () => {
		expect(source).toContain("isUpdaterInstallInProgress(updaterState)");
		expect(source).not.toContain(
			"updaterState.kind === \"installing\" || (downloadPercent !== null && downloadPercent >= 100)"
		);
		expect(source).not.toContain("{#if downloadPercent !== null && downloadPercent >= 100}");
	});

	it("uses the tracked dark logo asset on the splash background", () => {
		expect(source).toContain('import splashLogo from "../../../../../../assets/logo-dark.svg?url";');
		expect(source).toContain("<img src={splashLogo}");
		expect(source).not.toContain('import Logo from "$lib/components/logo.svelte"');
		expect(source).not.toContain("<Logo");
	});

	it("has an opaque card with no border", () => {
		expect(source).toContain("bg-background");
		expect(source).not.toContain("bg-background/80");
		expect(source).not.toContain("border: 1px solid");
	});
});
