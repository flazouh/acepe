<script lang="ts">
	import { AppTabBar, type AppTab } from '@acepe/ui/app-layout';
	import { AgentPanelLayout, type AnyAgentEntry } from '@acepe/ui/agent-panel';
	import { ProjectCard } from '@acepe/ui/project-card';

	const PROJECT_NAME = 'acepe';
	const PROJECT_COLOR = '#7C3AED';

	const tabs: AppTab[] = [
		{
			id: 'jwt',
			title: 'Migrate auth to JWT',
			projectName: PROJECT_NAME,
			projectColor: PROJECT_COLOR,
			agentIconSrc: '/svgs/agents/claude/claude-icon-dark.svg',
			mode: 'build',
			status: 'running',
			isFocused: true
		},
		{
			id: 'n-plus-one',
			title: 'Fix N+1 queries',
			projectName: PROJECT_NAME,
			projectColor: PROJECT_COLOR,
			agentIconSrc: '/svgs/agents/codex/codex-icon-dark.svg',
			mode: 'build',
			status: 'done',
			isFocused: false
		}
	];

	const jwtEntries: AnyAgentEntry[] = [
		{
			id: 'jwt-user',
			type: 'user',
			text: 'Migrate our auth system from session cookies to JWT tokens'
		},
		{ id: 'jwt-thinking', type: 'thinking' },
		{
			id: 'jwt-read',
			type: 'tool_call',
			kind: 'read',
			title: 'Read',
			filePath: 'src/lib/auth/session.ts',
			status: 'done'
		},
		{
			id: 'jwt-search',
			type: 'tool_call',
			kind: 'search',
			title: 'Grep',
			query: 'session_cookie',
			searchFiles: ['src/lib/auth/session.ts', 'src/middleware/auth.ts'],
			searchResultCount: 2,
			status: 'done'
		},
		{
			id: 'jwt-assistant',
			type: 'assistant',
			markdown:
				'JWT migration is underway. I added a token service and I am updating the middleware next.',
			isStreaming: true
		}
	];

	const queryEntries: AnyAgentEntry[] = [
		{
			id: 'query-user',
			type: 'user',
			text: 'Fix the N+1 queries on the users endpoint'
		},
		{
			id: 'query-read',
			type: 'tool_call',
			kind: 'read',
			title: 'Read',
			filePath: 'app/controllers/users_controller.rb',
			status: 'done'
		},
		{
			id: 'query-search',
			type: 'tool_call',
			kind: 'search',
			title: 'Grep',
			query: 'User.find',
			searchFiles: ['app/controllers/users_controller.rb', 'app/models/user.rb'],
			searchResultCount: 4,
			status: 'done'
		},
		{
			id: 'query-run',
			type: 'tool_call',
			kind: 'execute',
			title: 'Run',
			command: 'rails test test/controllers/users_controller_test.rb',
			stdout: '1 run, 3 assertions, 0 failures',
			exitCode: 0,
			status: 'done'
		},
		{
			id: 'query-assistant',
			type: 'assistant',
			markdown: 'N+1 queries fixed with eager loading. Requests now stay at **3 queries**.',
			isStreaming: false
		}
	];
</script>

<div class="space-y-2">
	<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30">
		<AppTabBar tabs={tabs} />
	</div>

	<ProjectCard
		projectName={PROJECT_NAME}
		projectColor={PROJECT_COLOR}
		variant="corner"
		class="min-w-0 bg-card/30"
	>
		<div class="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row">
			<div class="min-h-[18rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background">
				<AgentPanelLayout
					entries={jwtEntries}
					projectName={PROJECT_NAME}
					projectColor={PROJECT_COLOR}
					sessionTitle="Migrate auth to JWT"
					agentIconSrc="/svgs/agents/claude/claude-icon-dark.svg"
					sessionStatus="running"
					iconBasePath="/svgs/icons"
				/>
			</div>

			<div class="min-h-[18rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background">
				<AgentPanelLayout
					entries={queryEntries}
					projectName={PROJECT_NAME}
					projectColor={PROJECT_COLOR}
					sessionTitle="Fix N+1 queries"
					agentIconSrc="/svgs/agents/codex/codex-icon-dark.svg"
					sessionStatus="done"
					iconBasePath="/svgs/icons"
				/>
			</div>
		</div>
	</ProjectCard>
</div>
