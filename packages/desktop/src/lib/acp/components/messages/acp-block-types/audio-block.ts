import AudioBlockComponent from "./audio-block.svelte";
import type { AcpBlockRenderConfig } from "./types.js";

export const audioBlockConfig: AcpBlockRenderConfig<"audio"> = {
	type: "audio",
	component: AudioBlockComponent as unknown as AcpBlockRenderConfig<"audio">["component"],
	getProps: (block) => ({
		data: block.data,
		mimeType: block.mimeType,
	}),
};
