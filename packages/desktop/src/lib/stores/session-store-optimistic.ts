export type SessionSendMoment = {
	readonly text: string;
	readonly selectedAgentId: string | null;
	readonly projectName: string | null;
};

const FALLBACK_SESSION_TITLES = new Set(["New Thread", "New session", "New Session", "Loading..."]);
const GENERATED_SESSION_TITLE_PATTERN = /^Session [a-f0-9-]{6,}$/i;
const ATTACHMENT_TOKEN_PATTERN = /@\[(file|image|image_ref|text|command|skill):[^\]]+\]?/g;
const EXPANDED_ATTACHMENT_PATTERN = /\[Attached (?:image|file|PDF): [^\]]+\]/g;

const stripArtifactsFromTitle = (title: string): string => {
	const xmlTagPattern = /<([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>[\s\S]*?(?:<\/\1[^>]*>|(?=<[a-zA-Z])|$)/g;
	let cleaned = title;
	let previous = "";
	while (cleaned !== previous) {
		previous = cleaned;
		xmlTagPattern.lastIndex = 0;
		cleaned = cleaned.replace(xmlTagPattern, "");
	}
	ATTACHMENT_TOKEN_PATTERN.lastIndex = 0;
	EXPANDED_ATTACHMENT_PATTERN.lastIndex = 0;
	return cleaned
		.replace(ATTACHMENT_TOKEN_PATTERN, "")
		.replace(EXPANDED_ATTACHMENT_PATTERN, "")
		.trim();
};

const normalizeTitleForDisplay = (title: string): string =>
	stripArtifactsFromTitle(title).replace(/\\n/g, " ").replace(/\r?\n/g, " ").trim();

const isFallbackSessionTitle = (title: string): boolean => {
	const trimmedTitle = title.trim();
	return (
		FALLBACK_SESSION_TITLES.has(trimmedTitle) || GENERATED_SESSION_TITLE_PATTERN.test(trimmedTitle)
	);
};

const deriveSessionTitleFromUserInput = (input: string): string | null => {
	const trimmed = stripArtifactsFromTitle(input).trim();
	if (trimmed.length === 0 || trimmed.startsWith("/")) {
		return null;
	}
	const firstLine = trimmed.split(/\r?\n/u)[0];
	if (firstLine === undefined) {
		return null;
	}
	const first = firstLine.trim();
	if (first.length === 0) {
		return null;
	}
	return first;
};

const capitalizeTitle = (text: string): string => {
	if (text.length === 0) {
		return text;
	}
	return text.charAt(0).toUpperCase() + text.slice(1);
};

const formatSessionTitleForDisplay = (title: string | null, projectName: string | null): string => {
	const cleanedTitle = normalizeTitleForDisplay(title === null ? "" : title);
	if (cleanedTitle !== "") {
		return capitalizeTitle(cleanedTitle);
	}
	if (projectName !== null && projectName !== "Project") {
		return capitalizeTitle(`Conversation in ${projectName}`);
	}
	return "Untitled conversation";
};

export const resolveOptimisticHeaderTitle = (input: {
	readonly canonicalTitle: string | null;
	readonly pendingUserMessageText: string | null;
}): string | null => {
	if (input.canonicalTitle !== null && !isFallbackSessionTitle(input.canonicalTitle)) {
		return null;
	}
	if (input.pendingUserMessageText === null) {
		return null;
	}
	return deriveSessionTitleFromUserInput(input.pendingUserMessageText);
};

export const sessionStoreHeaderTitle = (input: {
	readonly canonicalTitle: string | null;
	readonly pendingUserMessageText: string | null;
	readonly projectName: string | null;
}): string | null => {
	const optimisticTitle = resolveOptimisticHeaderTitle({
		canonicalTitle: input.canonicalTitle,
		pendingUserMessageText: input.pendingUserMessageText,
	});
	const sessionTitle = optimisticTitle !== null ? optimisticTitle : input.canonicalTitle;
	if (sessionTitle === null && input.projectName === null) {
		return null;
	}
	return formatSessionTitleForDisplay(sessionTitle, input.projectName);
};

export const shouldShowClaudeWorkingSpark = (input: {
	readonly sessionAgentId: string | null;
	readonly selectedAgentId: string | null;
}): boolean => (input.sessionAgentId ?? input.selectedAgentId) === "claude-code";

export const sessionStoreView = (input: {
	readonly snapshot: {
		readonly session: {
			readonly title: string;
			readonly provider: string | null;
		} | null;
	};
	readonly sendMoment: SessionSendMoment | null;
}): {
	readonly headerTitle: string | null;
	readonly showWorkingSpark: boolean;
} => {
	const session = input.snapshot.session;
	const moment = input.sendMoment;
	return {
		headerTitle: sessionStoreHeaderTitle({
			canonicalTitle: session === null ? null : session.title,
			pendingUserMessageText: moment === null ? null : moment.text,
			projectName: moment === null ? null : moment.projectName,
		}),
		showWorkingSpark: shouldShowClaudeWorkingSpark({
			sessionAgentId: session === null ? null : session.provider,
			selectedAgentId: moment === null ? null : moment.selectedAgentId,
		}),
	};
};
