import { describe, expect, it } from "bun:test";

import {
	buildAudioBlockDisplayState,
	buildImageBlockDisplayState,
	getBase64DataUrl,
} from "./media-block-state.js";

describe("media-block-state", () => {
	it("builds base64 data urls", () => {
		expect(getBase64DataUrl("image/png", "abc123")).toBe("data:image/png;base64,abc123");
	});

	it("uses an image uri before base64 data", () => {
		expect(
			buildImageBlockDisplayState({
				uri: "asset://image.png",
				data: "abc123",
				mimeType: "image/png",
			})
		).toEqual({
			src: "asset://image.png",
			fallbackLabel: "Image (image/png)",
		});
	});

	it("builds an image data url when no uri exists", () => {
		expect(
			buildImageBlockDisplayState({
				data: "abc123",
				mimeType: "image/png",
			}).src
		).toBe("data:image/png;base64,abc123");
	});

	it("builds an image fallback when no source exists", () => {
		expect(
			buildImageBlockDisplayState({
				data: "",
				mimeType: "image/png",
			})
		).toEqual({
			src: null,
			fallbackLabel: "Image (image/png)",
		});
	});

	it("builds audio display state", () => {
		expect(buildAudioBlockDisplayState({ data: "xyz", mimeType: "audio/wav" })).toEqual({
			src: "data:audio/wav;base64,xyz",
			label: "Audio (audio/wav)",
		});
	});
});
