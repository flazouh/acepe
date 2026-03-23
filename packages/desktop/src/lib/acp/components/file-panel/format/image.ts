import type { FormatConfig } from "./types.js";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];

export const imageConfig: FormatConfig = {
	kind: "image",
	matchFile: (_, extension) => IMAGE_EXTENSIONS.includes(extension),
	displayOptions: {
		availableModes: ["rendered"],
		defaultMode: "rendered",
	},
};
