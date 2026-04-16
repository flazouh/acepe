export const STREAMING_ANIMATION_MODE_SMOOTH = "smooth";
export const STREAMING_ANIMATION_MODE_INSTANT = "instant";

export const STREAMING_ANIMATION_MODES = [
	STREAMING_ANIMATION_MODE_SMOOTH,
	STREAMING_ANIMATION_MODE_INSTANT,
] as const;

export type StreamingAnimationMode = (typeof STREAMING_ANIMATION_MODES)[number];

export const DEFAULT_STREAMING_ANIMATION_MODE: StreamingAnimationMode =
	STREAMING_ANIMATION_MODE_SMOOTH;

export function normalizeStreamingAnimationMode(
	value: string | null | undefined
): StreamingAnimationMode {
	void value;
	return DEFAULT_STREAMING_ANIMATION_MODE;
}
