export interface ResourceBlockDisplayState {
	header: string;
	text: string | undefined;
	hasText: boolean;
}

export interface ResourceLinkBlockDisplayState {
	uri: string;
	name: string;
	title: string | undefined;
	description: string | undefined;
	hasTitle: boolean;
	hasDescription: boolean;
	openTarget: "_blank";
	openFeatures: string;
}

export function buildResourceBlockDisplayState(resource: {
	uri: string;
	text?: string;
}): ResourceBlockDisplayState {
	return {
		header: `Resource: ${resource.uri}`,
		text: resource.text,
		hasText: Boolean(resource.text),
	};
}

export function buildResourceLinkBlockDisplayState(input: {
	uri: string;
	name: string;
	title?: string;
	description?: string;
}): ResourceLinkBlockDisplayState {
	return {
		uri: input.uri,
		name: input.name,
		title: input.title,
		description: input.description,
		hasTitle: Boolean(input.title),
		hasDescription: Boolean(input.description),
		openTarget: "_blank",
		openFeatures: "noopener,noreferrer",
	};
}
