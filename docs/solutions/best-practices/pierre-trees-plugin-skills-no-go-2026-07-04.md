---
module: skills
tags:
  - pierre-trees
  - ui
  - skills
problem_type: component-fit
---

# Pierre Trees No-Go: Active Plugin Skills

The active plugin-skills hierarchy is `PluginSkillsSection`, not the legacy
`SkillsTree` export.

`@pierre/trees` is a good fit for path-first file trees, but it is not a good
fit for the active plugin-skills list in this pass. The current rows show:

- plugin headers with skill counts;
- plugin skill names;
- two-line descriptions;
- read-only tooltip/icon treatment;
- a readable "Loading skills..." state for plugins whose skills are not loaded.

Pierre's row decoration lane can show short text like a count or data type, but
it cannot preserve the current multi-line skill description and read-only
surface without making the skills list harder to read.

Decision: keep `PluginSkillsSection` custom for now. Remove the unused legacy
`skills-tree.svelte` and `skills-tree-item.svelte` exports instead of migrating
dead code.
