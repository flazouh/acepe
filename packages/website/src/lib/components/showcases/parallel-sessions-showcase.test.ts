import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('ParallelSessionsShowcase', () => {
	it('uses shared UI building blocks instead of fake session skeletons', async () => {
		const source = await readFile(
			new URL('./parallel-sessions-showcase.svelte', import.meta.url),
			'utf8'
		);

		expect(source).toContain("import { AppTabBar, type AppTab } from '@acepe/ui/app-layout';");
		expect(source).toContain("import { ProjectCard } from '@acepe/ui/project-card';");
		expect(source).toContain(
			"import { AgentPanelLayout, type AnyAgentEntry } from '@acepe/ui/agent-panel';"
		);
		expect(source).toContain("const PROJECT_NAME = 'acepe';");
		expect(source).toContain("title: 'Migrate auth to JWT'");
		expect(source).toContain("title: 'Fix N+1 queries'");
		expect(source).not.toContain('SESSION 1');
		expect(source).not.toContain('SESSION 2');
		expect(source).not.toContain('h-1.5 w-full rounded-full');
	});
});
