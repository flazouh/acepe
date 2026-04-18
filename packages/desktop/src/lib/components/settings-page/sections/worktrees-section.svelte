<script lang="ts">
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree/worktree-default-store.svelte.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";

const worktreeDefaultStore = getWorktreeDefaultStore();
</script>

<div class="w-full">
	<SettingsSection
		title={"Worktrees"}
		description="Choose the default behavior for worktree-aware sessions."
	>
		<SettingRow
			label={"Use worktrees by default"}
			description={"New sessions will automatically use git worktrees for branch isolation"}
		>
			<Switch
				checked={worktreeDefaultStore.globalDefault}
				onCheckedChange={(checked) => {
					void worktreeDefaultStore.set(checked === true).match(
						() => {},
						() => {}
					);
				}}
			/>
		</SettingRow>
	</SettingsSection>
</div>
