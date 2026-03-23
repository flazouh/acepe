import { ResultAsync } from "neverthrow";

import type { SoundEffect } from "../types/sounds.js";

/**
 * Play a sound effect.
 * Sound files are located in /static/sounds/
 */
export function playSound(sound: SoundEffect): void {
	const audio = new Audio(`/sounds/${sound}`);
	ResultAsync.fromPromise(audio.play(), (e) => e as Error).mapErr(() => {
		// Silently ignore playback errors (e.g., autoplay restrictions)
	});
}
