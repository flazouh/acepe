export type ModelCapabilities = {
	temperature: boolean;
	reasoning: boolean;
	attachment: boolean;
	toolcall: boolean;
	input: {
		text: boolean;
		audio: boolean;
		image: boolean;
		video: boolean;
		pdf: boolean;
	};
	output: {
		text: boolean;
		audio: boolean;
		image: boolean;
		video: boolean;
		pdf: boolean;
	};
};
