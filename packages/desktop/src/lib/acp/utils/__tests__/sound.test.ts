import { beforeEach, describe, expect, it, vi } from "vitest";

import { SoundEffect } from "$lib/acp/types/sounds.js";

class FakeBufferSource {
	buffer: AudioBuffer | null = null;
	connectedTo: unknown = null;
	startCalls = 0;

	connect(destination: unknown): void {
		this.connectedTo = destination;
	}

	start(): void {
		this.startCalls += 1;
	}
}

class FakeAudioContext {
	state: AudioContextState = "suspended";
	destination = { label: "dest" };
	resume = vi.fn(async () => {
		this.state = "running";
	});
	decodeAudioData = vi.fn(async () => ({ decoded: true } as unknown as AudioBuffer));
	createBufferSource = vi.fn(() => new FakeBufferSource());
}

describe("sound utilities", () => {
	beforeEach(() => {
		delete (globalThis as Record<string, unknown>).AudioContext;
		delete (globalThis as Record<string, unknown>).fetch;
		delete (globalThis as Record<string, unknown>).Audio;
	});

	it("warms suspended audio context before cached playback", async () => {
		const fakeContext = new FakeAudioContext();
		const fetchMock = vi.fn(async () => ({
			arrayBuffer: async () => new ArrayBuffer(8),
		}));
		const AudioMock = vi.fn(() => ({ play: vi.fn(async () => undefined) }));

		Object.defineProperty(globalThis, "AudioContext", {
			value: vi.fn(() => fakeContext),
			configurable: true,
		});
		Object.defineProperty(globalThis, "Audio", {
			value: AudioMock,
			configurable: true,
		});
		Object.defineProperty(globalThis, "fetch", {
			value: fetchMock,
			configurable: true,
		});

		const { preloadSound, playSound } = await import("../sound.js");

		preloadSound(SoundEffect.SoundUp);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		playSound(SoundEffect.SoundUp);

		expect(fakeContext.resume).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith("/sounds/sound-up-2.mp3");
	});

	it("falls back to HTML Audio when sound is not cached", async () => {
		const playMock = vi.fn(async () => undefined);
		const AudioMock = vi.fn(() => ({ play: playMock }));

		Object.defineProperty(globalThis, "Audio", {
			value: AudioMock,
			configurable: true,
		});
		Object.defineProperty(globalThis, "AudioContext", {
			value: vi.fn(() => new FakeAudioContext()),
			configurable: true,
		});

		const { playSound } = await import("../sound.js");

		playSound(SoundEffect.SoundDown);

		expect(AudioMock).toHaveBeenCalledWith("/sounds/sound-down.mp3");
		expect(playMock).toHaveBeenCalledTimes(1);
	});
});
