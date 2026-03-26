import { ResultAsync } from "neverthrow";

import type { SoundEffect } from "../types/sounds.js";

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

	ResultAsync.fromPromise(ctx.resume(), (e) => e as Error).match(
		() => undefined,
		() => undefined,
	);
}

function getAudioContext(): AudioContext {
	if (audioContext === null) {
		audioContext = new AudioContext();
	}
	warmAudioContext(audioContext);
	return audioContext;
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
	ResultAsync.fromPromise(
		fetch(`/sounds/${sound}`)
			.then((response) => response.arrayBuffer())
			.then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer)),
		(e) => e as Error,
	).match(
		(buffer) => {
			bufferCache.set(sound, buffer);
		},
		() => {
			// Silently ignore preload errors — playSound falls back to HTML Audio
		},
	);
}

/**
 * Play a sound effect.
 * Uses pre-decoded Web Audio API buffers for near-zero latency when available,
 * falls back to HTML Audio element for sounds that haven't been preloaded.
 * Sound files are located in /static/sounds/
 */
export function playSound(sound: SoundEffect): void {
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
	ResultAsync.fromPromise(audio.play(), (e) => e as Error).mapErr(() => {
		// Silently ignore playback errors (e.g., autoplay restrictions)
	});
}
