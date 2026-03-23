import type { ContentBlock } from "../../../schemas/content-block.schema.js";
import { audioBlockConfig } from "./audio-block.js";
import { imageBlockConfig } from "./image-block.js";
import { resourceBlockConfig } from "./resource-block.js";
import { resourceLinkBlockConfig } from "./resource-link-block.js";
import { textBlockConfig } from "./text-block.js";
import type { AcpBlockRenderConfigUnion } from "./types.js";

export const ACP_BLOCK_RENDERERS: AcpBlockRenderConfigUnion[] = [
	textBlockConfig,
	imageBlockConfig,
	audioBlockConfig,
	resourceBlockConfig,
	resourceLinkBlockConfig,
];

export function getBlockRenderer(
	type: ContentBlock["type"]
): AcpBlockRenderConfigUnion | undefined {
	return ACP_BLOCK_RENDERERS.find((r) => r.type === type);
}
