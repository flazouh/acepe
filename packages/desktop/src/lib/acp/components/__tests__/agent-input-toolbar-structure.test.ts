import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const agentInputPath = resolve(__dirname, "../agent-input/agent-input-ui.svelte");
const agentInputSource = readFileSync(agentInputPath, "utf8");
const autonomousTogglePath = resolve(
	__dirname,
	"../agent-input/components/autonomous-toggle-button.svelte"
);
const autonomousToggleSource = readFileSync(autonomousTogglePath, "utf8");
const voiceRecordingOverlayPath = resolve(
	__dirname,
	"../agent-input/components/voice-recording-overlay.svelte"
);
const voiceRecordingOverlaySource = readFileSync(voiceRecordingOverlayPath, "utf8");

describe("agent input toolbar structure", () => {
	it("renders toolbar config options through the shared config selector", () => {
		expect(agentInputSource).toContain("ConfigOptionSelector");
		expect(agentInputSource).toContain("toolbarConfigOptions");
		expect(agentInputSource).toContain("handleConfigOptionChange");
		expect(agentInputSource).toContain("sessionStore.setConfigOption");
	});

	it("renders the Autonomous toggle through the shared toolbar cluster", () => {
		expect(agentInputSource).toContain("AutonomousToggleButton");
		expect(agentInputSource).toContain("handleAutonomousToggle");
		expect(agentInputSource).toContain("sessionStore.setAutonomousEnabled");
	});

	it("renders the Autonomous toggle with a Phosphor shield icon that fills when enabled", () => {
		expect(autonomousToggleSource).toContain('from "phosphor-svelte/lib/Shield"');
		expect(autonomousToggleSource).toContain('import { Colors } from "$lib/acp/utils/colors.js"');
		expect(autonomousToggleSource).toContain("Colors.red");
		expect(autonomousToggleSource).toContain('weight={active ? "fill" : "regular"}');
		expect(autonomousToggleSource).not.toMatch(/>\s*Autonomous\s*</);
	});

	it("keeps live voice meter styles on the overlay component", () => {
		expect(agentInputSource).not.toContain(".voice-bar {");
		expect(agentInputSource).not.toContain(".voice-meter {");
		expect(voiceRecordingOverlaySource).toContain(".voice-bar {");
		expect(voiceRecordingOverlaySource).toContain(".voice-meter {");
	});
});