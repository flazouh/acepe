<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import { SessionItem } from "$lib/components/ui/session-item/index.js";
import {
	type SessionListHighlightContext,
	setSessionListHighlightContext,
} from "./session-list-highlight-context.js";
import { buildSessionRows } from "./session-list-logic.js";
import type { SessionListItem as BaseSessionListItem } from "./session-list-types.js";

type SessionListItem = BaseSessionListItem & {
	worktreeDeleted?: boolean;
};

	interface Props {
		sessions: SessionListItem[];
		selectedSessionId: string | null;
		onSelectSession: (item: SessionListItem) => void;
		onOpenPr?: (item: SessionListItem) => void;
	onDelete?: (session: SessionDisplayItem) => void | Promise<void>;
	onArchive?: (session: SessionDisplayItem) => void | Promise<void>;
	onExportMarkdown?: (sessionId: string) => void | Promise<void>;
	onExportJson?: (sessionId: string) => void | Promise<void>;
	}

let {
	sessions,
	selectedSessionId,
	onSelectSession,
	onOpenPr,
	onDelete,
	onArchive,
		onExportMarkdown,
		onExportJson,
	}: Props = $props();

// Track which parent sessions are expanded
let expandedParents = new SvelteSet<string>();

// Build flattened rows with hierarchy info
const rows = $derived(buildSessionRows(sessions, expandedParents));

function handleSessionSelect(session: SessionListItem) {
	onSelectSession(session);
}

function handleToggleExpand(sessionId: string) {
	const newExpanded = new SvelteSet(expandedParents);
	if (newExpanded.has(sessionId)) {
		newExpanded.delete(sessionId);
	} else {
		newExpanded.add(sessionId);
	}
	expandedParents = newExpanded;
}

// Sliding highlight (same effect as dropdown): layer animates to hovered item
let containerRef: HTMLDivElement | undefined = $state();
let highlightRef: HTMLDivElement | undefined = $state();
let highlightTarget: HTMLElement | null = $state(null);

function updateHighlight(element: HTMLElement | null): void {
	highlightTarget = element;
}

function clearHighlight(): void {
	highlightTarget = null;
}

function getScrollParent(el: Element | null): Element | null {
	if (!el) return null;
	const { overflowY, overflowX } = getComputedStyle(el);
	if (
		["auto", "scroll", "overlay"].includes(overflowY) ||
		["auto", "scroll", "overlay"].includes(overflowX)
	)
		return el;
	return getScrollParent(el.parentElement);
}

function parsePx(value: string): number {
	return value ? parseFloat(value) || 0 : 0;
}

function applyHighlightPosition(): void {
	if (!highlightRef || !containerRef) return;
	if (!highlightTarget) {
		highlightRef.style.opacity = "0";
		return;
	}
	const containerRect = containerRef.getBoundingClientRect();
	const targetRect = highlightTarget.getBoundingClientRect();
	const style = getComputedStyle(containerRef);
	// Position relative to container's padding edge (where absolute children are anchored)
	const padT = parsePx(style.paddingTop);
	const padL = parsePx(style.paddingLeft);
	const inset = 1; // Keep highlight inside row bounds so it doesn't appear larger than the element
	const top = targetRect.top - containerRect.top - padT + inset;
	const left = targetRect.left - containerRect.left - padL + inset;
	const w = Math.max(0, targetRect.width - 2 * inset);
	const h = Math.max(0, targetRect.height - 2 * inset);
	highlightRef.style.top = `${top}px`;
	highlightRef.style.left = `${left}px`;
	highlightRef.style.width = `${w}px`;
	highlightRef.style.height = `${h}px`;
	highlightRef.style.opacity = "1";
}

$effect(() => {
	if (
		highlightRef &&
		containerRef &&
		(highlightTarget === null || highlightTarget instanceof HTMLElement)
	) {
		applyHighlightPosition();
	}
});

$effect(() => {
	if (!containerRef || !highlightTarget) return;
	const scrollEl = getScrollParent(containerRef) ?? containerRef;
	const onScroll = (): void => {
		if (highlightTarget) applyHighlightPosition();
	};
	scrollEl.addEventListener("scroll", onScroll, { passive: true });
	return () => scrollEl.removeEventListener("scroll", onScroll);
});

const highlightContext: SessionListHighlightContext = {
	updateHighlight,
	clearHighlight,
};
setSessionListHighlightContext(highlightContext);
</script>

<!-- Regular rendering - virtualization can be added later if needed -->
<div class="flex flex-col gap-0.5 py-0 p-0 relative min-h-0 min-w-0" bind:this={containerRef}>
	<div
		bind:this={highlightRef}
		class="pointer-events-none absolute rounded-md bg-accent/50 opacity-0 transition-[top,left,width,height,opacity] duration-75 ease-out"
		aria-hidden="true"
	></div>
	{#each rows as row (row.item.id)}
		<SessionItem
			thread={{
				id: row.item.id,
				title: row.item.title,
				projectPath: row.item.projectPath,
				projectName: row.item.projectName,
				agentId: row.item.agentId,
				createdAt: row.item.createdAt,
				updatedAt: row.item.updatedAt,
				activity: row.item.activity,
				insertions: row.item.insertions,
				deletions: row.item.deletions,
				entryCount: row.item.entryCount,
				worktreePath: row.item.worktreePath,
				worktreeDeleted: row.item.worktreeDeleted,
				prNumber: row.item.prNumber,
				prState: row.item.prState,
			}}
			selected={selectedSessionId === row.item.id}
			isOpen={row.item.isOpen}
			depth={row.depth}
			hasChildren={row.hasChildren}
			isExpanded={row.isExpanded}
			onSelect={() => handleSessionSelect(row.item)}
			onToggleExpand={() => handleToggleExpand(row.item.id)}
			onOpenPr={onOpenPr ? () => onOpenPr(row.item) : undefined}
			{onDelete}
			{onArchive}
			{onExportMarkdown}
			{onExportJson}
		/>
	{/each}
</div>
