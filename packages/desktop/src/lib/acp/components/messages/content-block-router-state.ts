import type { ContentBlock } from "../../schemas/content-block.schema.js";
import { validateContentBlock } from "../../utils/content-block-validator.js";

export type FileSrcConverter = (path: string) => string;

type TextBlockRenderData = {
	type: "text";
	text: string;
};

type ImageBlockRenderData = {
	type: "image";
	data: string;
	mimeType: string;
	uri?: string;
};

type AudioBlockRenderData = {
	type: "audio";
	data: string;
	mimeType: string;
};

type ResourceBlockRenderData = {
	type: "resource";
	resource: Extract<ContentBlock, { type: "resource" }>["resource"];
};

type ResourceLinkBlockRenderData = {
	type: "resource_link";
	uri: string;
	name: string;
	title?: string;
	description?: string;
};

export type ContentBlockRenderData =
	| TextBlockRenderData
	| ImageBlockRenderData
	| AudioBlockRenderData
	| ResourceBlockRenderData
	| ResourceLinkBlockRenderData;

export type ContentBlockRouteState =
	| {
			type: "render";
			block: ContentBlockRenderData;
	  }
	| {
			type: "invalid";
			message: string;
	  };

export function resolveContentBlockRouteState(
	block: unknown,
	convertFileSrc: FileSrcConverter
): ContentBlockRouteState {
	const validationResult = validateContentBlock(block);

	if (validationResult.isErr()) {
		return {
			type: "invalid",
			message: validationResult.error.message,
		};
	}

	const validatedBlock = validationResult.value;

	return {
		type: "render",
		block: buildContentBlockRenderData(validatedBlock, convertFileSrc),
	};
}

function buildContentBlockRenderData(
	block: ContentBlock,
	convertFileSrc: FileSrcConverter
): ContentBlockRenderData {
	switch (block.type) {
		case "text":
			return {
				type: "text",
				text: block.text,
			};
		case "image":
			return buildImageBlockRenderData(block, convertFileSrc);
		case "audio":
			return {
				type: "audio",
				data: block.data,
				mimeType: block.mimeType,
			};
		case "resource":
			return {
				type: "resource",
				resource: block.resource,
			};
		case "resource_link":
			return buildResourceLinkBlockRenderData(block);
	}

	return assertNeverContentBlock(block);
}

function buildImageBlockRenderData(
	block: Extract<ContentBlock, { type: "image" }>,
	convertFileSrc: FileSrcConverter
): ImageBlockRenderData {
	const normalizedUri = normalizeImageUri(block.uri, convertFileSrc);
	if (normalizedUri === undefined) {
		return {
			type: "image",
			data: block.data,
			mimeType: block.mimeType,
		};
	}

	return {
		type: "image",
		data: block.data,
		mimeType: block.mimeType,
		uri: normalizedUri,
	};
}

function buildResourceLinkBlockRenderData(
	block: Extract<ContentBlock, { type: "resource_link" }>
): ResourceLinkBlockRenderData {
	const renderData: ResourceLinkBlockRenderData = {
		type: "resource_link",
		uri: block.uri,
		name: block.name,
	};

	if (block.title !== undefined) {
		renderData.title = block.title;
	}

	if (block.description !== undefined) {
		renderData.description = block.description;
	}

	return renderData;
}

function normalizeImageUri(
	uri: string | null | undefined,
	convertFileSrc: FileSrcConverter
): string | undefined {
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

function assertNeverContentBlock(_block: never): never {
	throw new Error("Unsupported content block type");
}
