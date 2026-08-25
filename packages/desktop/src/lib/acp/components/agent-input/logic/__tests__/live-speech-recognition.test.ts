import { describe, expect, it } from "vitest";

import {
	collectSpeechRecognitionText,
	createBrowserLiveSpeechSession,
	type SpeechRecognitionLike,
	type SpeechRecognitionResultListLike,
	speechRecognitionFailureMessage,
} from "../live-speech-recognition.js";

class FakeRecognition implements SpeechRecognitionLike {
	continuous = false;
	interimResults = false;
	lang = "";
	onresult: SpeechRecognitionLike["onresult"] = null;
	onerror: SpeechRecognitionLike["onerror"] = null;
	onend: SpeechRecognitionLike["onend"] = null;
	started = false;

	start(): void {
		this.started = true;
	}

	stop(): void {
		this.started = false;
		this.onend?.();
	}

	abort(): void {
		this.started = false;
		this.onend?.();
	}

	emit(results: SpeechRecognitionResultListLike): void {
		this.onresult?.({ results });
	}
}

describe("collectSpeechRecognitionText", () => {
	it("joins final transcripts with a space", () => {
		expect(
			collectSpeechRecognitionText([
				{ isFinal: true, transcript: "hello" },
				{ isFinal: true, transcript: " world " },
			])
		).toBe("hello world");
	});

	it("uses interim text when no final result exists", () => {
		expect(collectSpeechRecognitionText([{ isFinal: false, transcript: "hold on" }])).toBe(
			"hold on"
		);
	});

	it("returns an empty string when every transcript is blank", () => {
		expect(
			collectSpeechRecognitionText([
				{ isFinal: true, transcript: "   " },
				{ isFinal: false, transcript: "" },
			])
		).toBe("");
	});
});

describe("speechRecognitionFailureMessage", () => {
	it("names permission and capture failures", () => {
		expect(speechRecognitionFailureMessage("not-allowed")).toBe("Microphone permission denied");
		expect(speechRecognitionFailureMessage("service-not-allowed")).toBe(
			"Speech recognition is not allowed"
		);
		expect(speechRecognitionFailureMessage("audio-capture")).toBe("No microphone found");
		expect(speechRecognitionFailureMessage("no-speech")).toBeNull();
	});
});

describe("createBrowserLiveSpeechSession", () => {
	it("starts recognition and returns the spoken text on stop", async () => {
		const holder: { current: FakeRecognition | null } = { current: null };
		class TrackingRecognition extends FakeRecognition {
			constructor() {
				super();
				holder.current = this;
			}
		}
		const session = createBrowserLiveSpeechSession(TrackingRecognition);

		expect(session.start("en-US")).toBe("started");
		expect(holder.current?.lang).toBe("en-US");
		expect(holder.current?.started).toBe(true);

		holder.current?.emit({
			length: 1,
			0: {
				isFinal: true,
				0: { transcript: "hello composer" },
			},
		});

		const spoken = session.stop();
		await expect(spoken).resolves.toBe("hello composer");
	});

	it("leaves language unset when the caller has no language", () => {
		const holder: { current: FakeRecognition | null } = { current: null };
		class TrackingRecognition extends FakeRecognition {
			constructor() {
				super();
				holder.current = this;
			}
		}
		const session = createBrowserLiveSpeechSession(TrackingRecognition);

		expect(session.start(null)).toBe("started");
		expect(holder.current?.lang).toBe("");
	});
});
