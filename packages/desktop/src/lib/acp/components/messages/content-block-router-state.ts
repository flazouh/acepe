import type { ContentBlock } from "../../schemas/content-block.schema.js";
import { validateContentBlock } from "../../utils/content-block-validator.js";
import { getBlockRenderer } from "./acp-block-types/registry.js";
import type { AcpBlockRenderConfigUnion } from "./acp-block-types/types.js";

export type ContentBlockRouteState =
	| {
			type: "render";
			block: ContentBlock;
			renderer: AcpBlockRenderConfigUnion;
			props: Record<string, unknown>;
	  }
	| {
			type: "unknown";
			blockType: ContentBlock["type"];
	  }
	| {
			type: "invalid";
			message: string;
	  };

export function resolveContentBlockRouteState(
	block: unknown,
	findRenderer: (type: ContentBlock["type"]) => AcpBlockRenderConfigUnion | undefined = getBlockRenderer
): ContentBlockRouteState {
	const validationResult = validateContentBlock(block);

	if (validationResult.isErr()) {
		return {
			type: "invalid",
			message: validationResult.error.message,
		};
	}

	const validatedBlock = validationResult.value;
	const renderer = findRenderer(validatedBlock.type);

	if (!renderer) {
		return {
			type: "unknown",
			blockType: validatedBlock.type,
		};
	}

	return {
		type: "render",
		block: validatedBlock,
		renderer,
		props: getContentBlockRendererProps(renderer, validatedBlock),
	};
}

function getContentBlockRendererProps(
	renderer: AcpBlockRenderConfigUnion,
	block: ContentBlock
): Record<string, unknown> {
	return (renderer as { getProps: (b: ContentBlock) => Record<string, unknown> }).getProps(block);
}
