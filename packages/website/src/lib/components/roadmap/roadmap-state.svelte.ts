import { ResultAsync, errAsync } from 'neverthrow';

export type RoadmapCard = {
	id: string;
	title: string;
	category: 'bug' | 'enhancement' | 'question' | 'discussion';
	status: 'open' | 'under_review' | 'planned' | 'in_progress' | 'completed' | 'closed' | 'wont_fix';
	upvoteCount: number;
	currentUserVote: 'up' | 'down' | null;
	createdAt: string;
};

export type RoadmapColumn = {
	items: RoadmapCard[];
	totalCount: number;
};

export type RoadmapColumns = Record<string, RoadmapColumn>;

export class RoadmapState {
	columns = $state<RoadmapColumns>({});
	userId = $state<string | null>(null);

	constructor(data: { columns: RoadmapColumns; userId: string | null }) {
		this.columns = structuredClone(data.columns);
		this.userId = data.userId;
	}

	get isAuthenticated(): boolean {
		return this.userId !== null;
	}

	findCard(cardId: string): RoadmapCard | undefined {
		for (const col of Object.values(this.columns)) {
			const card = col.items.find((c) => c.id === cardId);
			if (card) return card;
		}
		return undefined;
	}

	castVote(cardId: string, voteType: 'up' | 'down'): ResultAsync<void, Error> {
		const card = this.findCard(cardId);
		if (!card) return errAsync(new Error('Card not found'));

		// Snapshot for rollback
		const prevVote = card.currentUserVote;
		const prevCount = card.upvoteCount;

		// Determine if toggling off or changing vote
		const isRemovingVote = card.currentUserVote === voteType;

		// Optimistic mutation
		if (isRemovingVote) {
			card.currentUserVote = null;
			if (voteType === 'up') {
				card.upvoteCount = card.upvoteCount - 1;
			}
		} else {
			const hadUpvote = prevVote === 'up';
			card.currentUserVote = voteType;
			if (voteType === 'up') {
				card.upvoteCount = card.upvoteCount + (hadUpvote ? 0 : 1);
			} else if (hadUpvote) {
				card.upvoteCount = card.upvoteCount - 1;
			}
		}

		const method = isRemovingVote ? 'DELETE' : 'PUT';
		const fetchOptions: RequestInit = {
			method,
			headers: { 'Content-Type': 'application/json' }
		};
		if (!isRemovingVote) {
			fetchOptions.body = JSON.stringify({ voteType });
		}

		return ResultAsync.fromPromise(
			fetch(`/api/reports/${cardId}/vote`, fetchOptions).then((res) => {
				if (!res.ok) throw new Error(`Vote failed: ${res.status}`);
			}),
			(e) => (e instanceof Error ? e : new Error(String(e)))
		).mapErr((err) => {
			// Rollback on failure
			const c = this.findCard(cardId);
			if (c) {
				c.currentUserVote = prevVote;
				c.upvoteCount = prevCount;
			}
			return err;
		});
	}
}
