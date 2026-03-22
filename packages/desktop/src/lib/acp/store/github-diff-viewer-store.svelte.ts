import { get, type Readable, type Subscriber, type Unsubscriber, writable } from "svelte/store";

export type GitHubDiffViewerReference =
	| {
			type: "commit";
			sha: string;
			owner?: string;
			repo?: string;
	  }
	| {
			type: "pr";
			owner: string;
			repo: string;
			number: number;
	  };

export interface OpenGitHubDiffViewerInput {
	readonly reference: GitHubDiffViewerReference;
	readonly projectPath?: string;
}

export interface GitHubDiffViewerState {
	readonly opened: boolean;
	readonly reference: GitHubDiffViewerReference | null;
	readonly projectPath: string | null;
}

const INITIAL_STATE: GitHubDiffViewerState = {
	opened: false,
	reference: null,
	projectPath: null,
};

export class GitHubDiffViewerStore implements Readable<GitHubDiffViewerState> {
	private readonly state = writable<GitHubDiffViewerState>(INITIAL_STATE);

	subscribe(run: Subscriber<GitHubDiffViewerState>): Unsubscriber {
		return this.state.subscribe(run);
	}

	get opened(): boolean {
		return get(this.state).opened;
	}

	get reference(): GitHubDiffViewerReference | null {
		return get(this.state).reference;
	}

	get projectPath(): string | null {
		return get(this.state).projectPath;
	}

	open(input: OpenGitHubDiffViewerInput): void {
		this.state.set({
			opened: true,
			reference: input.reference,
			projectPath: input.projectPath ?? null,
		});
	}

	close(): void {
		this.state.set(INITIAL_STATE);
	}
}

export const gitHubDiffViewerStore = new GitHubDiffViewerStore();
