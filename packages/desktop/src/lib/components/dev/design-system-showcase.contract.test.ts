import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./design-system-showcase.svelte"), "utf8");

describe("design system showcase contract", () => {
	it("adds a dedicated buttons section to the design system overlay", () => {
		expect(source).toContain('id: "permission-card"');
		expect(source).toContain('label: "Permission Card"');
		expect(source).toContain('{#if activeSection === "permission-card"}');
		expect(source).toContain('Permission Card');
		expect(source).toContain('variant="toolbar"');
		expect(source).toContain('size="toolbar"');
	});

	it("rebuilds the kanban card showcase from anatomy to full states", () => {
		expect(source).toContain("Permission Card");
		expect(source).toContain("Toolbar Buttons");
		expect(source).toContain("Segmented Progress");
		expect(source).toContain("Single Permission");
		expect(source).toContain("Long Command");
	});

	it("shows desktop-style kanban card wiring in the showcase", () => {
		expect(source).toContain("VoiceDownloadProgress");
		expect(source).toContain("function close()");
		expect(source).toContain('import { Button } from "@acepe/ui/button";');
		expect(source).toContain("interface Props");
		expect(source).toContain('variant="toolbar"');
		expect(source).toContain('size="toolbar"');
		expect(source).toContain("CheckCircle");
		expect(source).toContain("XCircle");
		expect(source).toContain("ShieldWarning");
		expect(source).toContain("ShieldCheck");
		expect(source).toContain('import CheckCircle from "phosphor-svelte/lib/CheckCircle";');
		expect(source).toContain('import XCircle from "phosphor-svelte/lib/XCircle";');
	});
});
