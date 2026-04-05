import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SoundEffect } from "$lib/acp/types/sounds.js";

const APP_START_SOUND = "app-start.wav" as SoundEffect;
const NOTIFICATION_SOUND = "Notification.wav" as SoundEffect;
const SOUND_DOWN = "sound-down.mp3" as SoundEffect;
const SOUND_UP = "sound-up-2.mp3" as SoundEffect;
const soundSource = readFileSync(resolve(import.meta.dir, "../sound.ts"), "utf8");

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

	it("guards only the startup sound in dev mode", () => {
		expect(soundSource).toContain("return !(isDevMode && sound === SoundEffect.AppStart);");
		expect(APP_START_SOUND).toBe("app-start.wav");
		expect(NOTIFICATION_SOUND).toBe("Notification.wav");
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

		const { preloadSound, playSound } = await import(`../sound.js?case=warm-${Date.now()}`);

		preloadSound(SOUND_UP);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		playSound(SOUND_UP);

		expect(fakeContext.resume).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(`/sounds/${SOUND_UP}`);
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

		const { playSound } = await import(`../sound.js?case=fallback-${Date.now()}`);

		playSound(SOUND_DOWN);

		expect(AudioMock).toHaveBeenCalledWith(`/sounds/${SOUND_DOWN}`);
		expect(playMock).toHaveBeenCalledTimes(1);
	});
});
