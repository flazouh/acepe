import type { ReportCategory, ReportStatus, SortBy, ReportOutput, CommentOutput } from '@acepe/api';
import type { Component } from 'svelte';
import { Bug, ChatCircle, CheckCircle, Circle, CircleHalf, Eye, Lightbulb, MapPin, Prohibit, Question, XCircle } from 'phosphor-svelte';
export type { ReportCategory, ReportStatus, SortBy, ReportOutput, CommentOutput };

export type View =
	| { kind: 'list' }
	| { kind: 'detail'; reportId: string }
	| { kind: 'create' };

export const CATEGORY_CONFIG = {
	bug: { label: 'Bug', icon: Bug, classes: 'bg-[#FF5D5A]/10 text-[#FF5D5A] border-[#FF5D5A]/25' },
	feature_request: {
		label: 'Feature',
		icon: Lightbulb,
		classes: 'bg-[#9858FF]/10 text-[#9858FF] border-[#9858FF]/25'
	},
	question: {
		label: 'Question',
		icon: Question,
		classes: 'bg-[#4AD0FF]/10 text-[#4AD0FF] border-[#4AD0FF]/25'
	},
	discussion: {
		label: 'Discussion',
		icon: ChatCircle,
		classes: 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/25'
	}
} as const;

export const STATUS_CONFIG = {
	open: { label: 'Open', icon: Circle, color: 'text-[var(--success)]' },
	under_review: { label: 'Review', icon: Eye, color: 'text-[#FF8D20]' },
	planned: { label: 'Planned', icon: MapPin, color: 'text-[#4AD0FF]' },
	in_progress: { label: 'In Progress', icon: CircleHalf, color: 'text-[#9858FF]' },
	completed: { label: 'Done', icon: CheckCircle, color: 'text-[var(--success)]' },
	closed: { label: 'Closed', icon: XCircle, color: 'text-[#FF5D5A]' },
	wont_fix: { label: "Won't Fix", icon: Prohibit, color: 'text-[#FF5D5A]' }
} as const;

export function formatTimeAgo(iso: string): string {
	const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (seconds < 60) return 'now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d`;
	return `${Math.floor(seconds / 2592000)}mo`;
}
