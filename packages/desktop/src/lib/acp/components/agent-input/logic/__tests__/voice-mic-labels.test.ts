import { describe, expect, it } from "vitest";

import { resolveVoiceMicShortcut, resolveVoiceMicTooltip } from "../voice-mic-labels.js";

const labels = {
	downloadingModel: "Downloading speech model…",
	loadingModel: "Loading model...",
	checkingPermission: "Checking...",
	transcribing: "Transcribing…",
	stopRecording: "Stop recording",
	startRecording: "Start voice recording",
} as const;

const holdShortcut = ["⌥"] as const;

describe("resolveVoiceMicTooltip", () => {
	it("uses start and stop copy for the hold phases", () => {
		expect(resolveVoiceMicTooltip("idle", labels)).toBe("Start voice recording");
		expect(resolveVoiceMicTooltip("recording", labels)).toBe("Stop recording");
	});
});

describe("resolveVoiceMicShortcut", () => {
	it("shows the hold key on idle and recording", () => {
		expect(resolveVoiceMicShortcut("idle", holdShortcut)).toEqual(["⌥"]);
		expect(resolveVoiceMicShortcut("recording", holdShortcut)).toEqual(["⌥"]);
	});

	it("hides the hold key while the mic is busy", () => {
		expect(resolveVoiceMicShortcut("checking_permission", holdShortcut)).toEqual([]);
		expect(resolveVoiceMicShortcut("downloading_model", holdShortcut)).toEqual([]);
		expect(resolveVoiceMicShortcut("loading_model", holdShortcut)).toEqual([]);
		expect(resolveVoiceMicShortcut("transcribing", holdShortcut)).toEqual([]);
	});
});
