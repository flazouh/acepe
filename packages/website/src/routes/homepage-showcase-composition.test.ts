import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('homepage showcase composition', () => {
	it('uses extracted showcase components for the homepage feature cards', async () => {
		const source = await readFile(new URL('./+page.svelte', import.meta.url), 'utf8');

		expect(source).toContain(
			'import ParallelSessionsShowcase from "$lib/components/showcases/parallel-sessions-showcase.svelte";'
		);
		expect(source).toContain(
			'import SessionListPanel from "$lib/components/showcases/session-list-panel.svelte";'
		);
		expect(source).toContain(
			'import CommandPaletteShell from "$lib/components/showcases/command-palette-shell.svelte";'
		);
		expect(source).toContain(
			'import SqlStudioHomepageShowcase from "$lib/components/showcases/sql-studio-homepage-showcase.svelte";'
		);
		expect(source).toContain('<AgentIconsRow size={24} class="mb-6" />');
		expect(source).toContain('<ParallelSessionsShowcase');
		expect(source).toContain('<SessionListPanel');
		expect(source).toContain('<CommandPaletteShell');
		expect(source).toContain('<SqlStudioHomepageShowcase');
		expect(source).not.toContain('<AppTabBar tabs={mockTabs} />');
		expect(source).not.toContain('grid grid-cols-2 gap-1 rounded-lg border border-border/50 bg-card/30 p-2');
		expect(source).not.toContain('Search sessions...');
		expect(source).not.toContain('Type a command...');
		expect(source).not.toContain('<SqlStudioDataGrid');
		expect(source).not.toContain('<AppSessionItemComponent');
	});
});
