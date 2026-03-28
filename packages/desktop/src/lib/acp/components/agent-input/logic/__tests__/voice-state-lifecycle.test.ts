import { describe, expect, it } from "vitest";

import { resolveVoiceStateLifecycle } from "../voice-state-lifecycle.js";

describe("voice-state-lifecycle", () => {
	it("initializes voice state when voice becomes enabled for a session", () => {
		expect(resolveVoiceStateLifecycle(null, "session-1", true)).toBe("init");
	});

	it("replaces voice state when the session changes", () => {
		expect(resolveVoiceStateLifecycle("session-1", "session-2", true)).toBe("replace");
	});

	it("disposes voice state when voice is disabled", () => {
		expect(resolveVoiceStateLifecycle("session-1", "session-1", false)).toBe("dispose");
	});

	it("does nothing when the existing voice state already matches", () => {
		expect(resolveVoiceStateLifecycle("session-1", "session-1", true)).toBe("noop");
	});
});
