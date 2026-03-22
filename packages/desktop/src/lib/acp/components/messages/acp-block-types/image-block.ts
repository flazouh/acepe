import { convertFileSrc } from "@tauri-apps/api/core";
import ImageBlockComponent from "./image-block.svelte";
import type { AcpBlockRenderConfig } from "./types.js";

function normalizeImageUri(uri: string | null | undefined): string | undefined {
	if (!uri) {
		return undefined;
	}

	if (
		uri.startsWith("http://") ||
		uri.startsWith("https://") ||
		uri.startsWith("data:") ||
		uri.startsWith("asset:")
	) {
		return uri;
	}

	return convertFileSrc(uri);
}

export const imageBlockConfig: AcpBlockRenderConfig<"image"> = {
	type: "image",
	component: ImageBlockComponent as unknown as AcpBlockRenderConfig<"image">["component"],
	getProps: (block) => ({
		data: block.data,
		mimeType: block.mimeType,
		uri: normalizeImageUri(block.uri),
	}),
};
