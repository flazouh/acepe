<script lang="ts">
import { FolderSimple } from "phosphor-svelte";
import SettingsComingSoon from "../settings-coming-soon.svelte";
import SettingsSection from "../settings-section.svelte";
</script>

<div class="w-full">
	<SettingsSection
		title="Environments"
		description="Control which environment files are shared with worktrees and per-agent env overrides."
	>
		<SettingsComingSoon
			icon={FolderSimple}
			headline="Environment management"
			description="Env-file copy allowlist for worktree creation and per-agent environment variable overrides will live here."
		/>
	</SettingsSection>
</div>
