import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";

import type { SoundEffect } from "../types/sounds.js";

const APP_START_SOUND_FILE = "app-start.wav";

/**
 * Pre-decoded audio buffer cache.
 * Buffers are fetched + decoded once, then replayed instantly via Web Audio API.
 */
const bufferCache = new Map<SoundEffect, AudioBuffer>();
let audioContext: AudioContext | null = null;

function warmAudioContext(ctx: AudioContext): void {
	if (ctx.state !== "suspended") {
		return;
	}

	void Effect.runPromise(
		fromPromise(
			() => ctx.resume(),
			(e) => (e instanceof Error ? e : new Error(String(e)))
		).pipe(
			Effect.match({
				onSuccess: () => undefined,
				onFailure: () => undefined,
			})
		)
	);
}

function getAudioContext(): AudioContext {
	if (audioContext === null) {
		audioContext = new AudioContext();
	}
	warmAudioContext(audioContext);
	return audioContext;
}

export function shouldPlaySound(
	sound: SoundEffect,
	isDevMode: boolean = import.meta.env.DEV
): boolean {
	return !(isDevMode && sound === APP_START_SOUND_FILE);
}

/**
 * Preload a sound effect into the buffer cache.
 * Call this at app startup for latency-critical sounds.
 */
export function preloadSound(sound: SoundEffect): void {
	if (bufferCache.has(sound)) {
		return;
	}
	const ctx = getAudioContext();
	void Effect.runPromise(
		fromPromise(
			() =>
				fetch(`/sounds/${sound}`)
					.then((response) => response.arrayBuffer())
					.then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer)),
			(e) => (e instanceof Error ? e : new Error(String(e)))
		).pipe(
			Effect.match({
				onSuccess: (buffer) => {
					bufferCache.set(sound, buffer);
				},
				onFailure: () => {
					// Silently ignore preload errors — playSound falls back to HTML Audio
				},
			})
		)
	);
}

/**
 * Play a sound effect.
 * Uses pre-decoded Web Audio API buffers for near-zero latency when available,
 * falls back to HTML Audio element for sounds that haven't been preloaded.
 * Sound files are located in /static/sounds/
 */
export function playSound(sound: SoundEffect): void {
	if (!shouldPlaySound(sound)) {
		return;
	}

	const cached = bufferCache.get(sound);
	if (cached) {
		const ctx = getAudioContext();
		const source = ctx.createBufferSource();
		source.buffer = cached;
		source.connect(ctx.destination);
		source.start(0);
		return;
	}

	// Fallback: non-preloaded sounds use HTML Audio (higher latency)
	const audio = new Audio(`/sounds/${sound}`);
	void Effect.runPromise(
		fromPromise(
			() => audio.play(),
			(e) => (e instanceof Error ? e : new Error(String(e)))
		).pipe(
			Effect.match({
				onSuccess: () => undefined,
				onFailure: () => {
					// Silently ignore playback errors (e.g., autoplay restrictions)
				},
			})
		)
	);
}
