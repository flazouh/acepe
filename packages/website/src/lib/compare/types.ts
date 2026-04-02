export interface ComparisonFeatureRow {
	readonly category: string;
	readonly feature: string;
	readonly acepe: string | boolean;
	readonly competitor: string | boolean;
}

export interface ComparisonDifferentiator {
	readonly title: string;
	readonly description: string;
}

export interface ComparisonFaq {
	readonly question: string;
	readonly answer: string;
}

export interface ComparisonSourceNote {
	readonly url: string;
	readonly note: string;
}

export type ComparisonVerificationStatus = 'verified' | 'draft';

export interface ComparisonData {
	readonly slug: string;
	readonly competitorName: string;
	readonly competitorUrl: string;
	readonly verificationStatus: ComparisonVerificationStatus;
	readonly lastVerifiedOn: string | null;
	readonly sourceNotes: readonly ComparisonSourceNote[];
	readonly heroTagline: string;
	readonly heroDescription: string;
	readonly features: readonly ComparisonFeatureRow[];
	readonly differentiators: readonly ComparisonDifferentiator[];
	readonly faqs: readonly ComparisonFaq[];
	readonly metaTitle: string;
	readonly metaDescription: string;
}
