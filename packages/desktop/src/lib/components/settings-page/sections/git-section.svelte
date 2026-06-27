<script lang="ts">
import { GitBranch } from "@acepe/ui/icons";
import SettingsComingSoon from "../settings-coming-soon.svelte";
import SettingsSection from "../settings-section.svelte";
</script>

<div class="w-full">
	<SettingsSection>
		<SettingsComingSoon
			icon={GitBranch}
			headline="Git preferences"
			description="Branch-naming conventions, diff viewer defaults, and git-adjacent worktree flags will live here."
		/>
	</SettingsSection>
</div>
