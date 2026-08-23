import { describe, expect, it } from "vitest";
import { AgentError, ValidationError } from "../../../../errors/app-error.js";
import { resolveVoiceFailureMessage } from "../voice-error-message.js";

describe("resolveVoiceFailureMessage", () => {
	it("surfaces a permission-denied cause instead of the generic wrapper", () => {
		const cause = new Error(
			"Microphone permission denied. Check System Settings → Privacy & Security → Microphone."
		);
		const err = new AgentError("voice.recording.start", cause);

		expect(resolveVoiceFailureMessage(err, "fallback")).toBe(
			"Microphone permission denied. Check System Settings → Privacy & Security → Microphone."
		);
	});

	it("surfaces a no-input-device cause instead of the generic wrapper", () => {
		const cause = new Error(
			"No audio input device available. On macOS, check System Settings → Privacy & Security → Microphone."
		);
		const err = new AgentError("voice.recording.start", cause);

		expect(resolveVoiceFailureMessage(err, "fallback")).toBe(
			"No audio input device available. On macOS, check System Settings → Privacy & Security → Microphone."
		);
	});

	it("surfaces a dispatch/transport failure cause instead of the generic wrapper", () => {
		const cause = new Error("RPC transport error: bun process killed");
		const err = new AgentError("voice.model.status", cause);

		expect(resolveVoiceFailureMessage(err, "fallback")).toBe(
			"RPC transport error: bun process killed"
		);
	});

	it("produces distinct messages for distinct failure kinds", () => {
		const permission = resolveVoiceFailureMessage(
			new AgentError("voice.recording.start", new Error("Microphone permission denied.")),
			"fallback"
		);
		const noDevice = resolveVoiceFailureMessage(
			new AgentError("voice.recording.start", new Error("No audio input device available.")),
			"fallback"
		);
		const dispatch = resolveVoiceFailureMessage(
			new AgentError("voice.model.status", new Error("RPC transport error: socket closed")),
			"fallback"
		);

		expect(new Set([permission, noDevice, dispatch]).size).toBe(3);
	});

	it("falls back to the AgentError's own message when there is no distinct cause", () => {
		const err = new AgentError("voice.model.status");

		expect(resolveVoiceFailureMessage(err, "fallback")).toBe(
			"Agent operation failed: voice.model.status"
		);
	});

	it("falls back to the AgentError's own message when the cause carries a blank message", () => {
		const err = new AgentError("voice.model.status", new Error(""));

		expect(resolveVoiceFailureMessage(err, "fallback")).toBe(
			"Agent operation failed: voice.model.status"
		);
	});

	it("falls back to the caller-provided default when the error itself has no message", () => {
		const err = new ValidationError("");

		expect(resolveVoiceFailureMessage(err, "Voice command failed")).toBe("Voice command failed");
	});
});
