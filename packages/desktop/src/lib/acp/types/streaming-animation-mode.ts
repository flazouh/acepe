export const STREAMING_ANIMATION_MODE_SMOOTH = "smooth";
export const STREAMING_ANIMATION_MODE_CLASSIC = "classic";
export const STREAMING_ANIMATION_MODE_INSTANT = "instant";

export const STREAMING_ANIMATION_MODES = [
	STREAMING_ANIMATION_MODE_SMOOTH,
	STREAMING_ANIMATION_MODE_CLASSIC,
	STREAMING_ANIMATION_MODE_INSTANT,
] as const;

export type StreamingAnimationMode = (typeof STREAMING_ANIMATION_MODES)[number];

export const DEFAULT_STREAMING_ANIMATION_MODE: StreamingAnimationMode =
	STREAMING_ANIMATION_MODE_SMOOTH;

function isStreamingAnimationMode(value: string): value is StreamingAnimationMode {
	return (
		value === STREAMING_ANIMATION_MODE_SMOOTH ||
		value === STREAMING_ANIMATION_MODE_CLASSIC ||
		value === STREAMING_ANIMATION_MODE_INSTANT
	);
}

export function normalizeStreamingAnimationMode(
	value: string | null | undefined
): StreamingAnimationMode {
	if (value === null || value === undefined) {
		return DEFAULT_STREAMING_ANIMATION_MODE;
	}

	if (isStreamingAnimationMode(value)) {
		return value;
	}

	if (value === "typewriter") {
		return STREAMING_ANIMATION_MODE_CLASSIC;
	}

	if (value === "none") {
		return STREAMING_ANIMATION_MODE_INSTANT;
	}

	if (value === "fade" || value === "glow") {
		return STREAMING_ANIMATION_MODE_SMOOTH;
	}

	return DEFAULT_STREAMING_ANIMATION_MODE;
}
