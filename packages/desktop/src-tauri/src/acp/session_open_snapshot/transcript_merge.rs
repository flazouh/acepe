use crate::acp::projections::{OperationSnapshot, OperationSourceLink};
use crate::acp::transcript_projection::{
    TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use std::collections::HashSet;

pub(super) fn merge_provider_tool_rows_into_local_transcript(
    mut local: TranscriptSnapshot,
    provider: &TranscriptSnapshot,
    operations: &[OperationSnapshot],
) -> TranscriptSnapshot {
    let linked_tool_entry_ids = operations
        .iter()
        .filter_map(|operation| match &operation.source_link {
            OperationSourceLink::TranscriptLinked { entry_id } => Some(entry_id.clone()),
            OperationSourceLink::Synthetic { .. } | OperationSourceLink::Degraded { .. } => None,
        })
        .collect::<HashSet<_>>();
    let provider_tool_entries = provider
        .entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| {
            entry.role == TranscriptEntryRole::Tool
                && linked_tool_entry_ids.contains(&entry.entry_id)
        })
        .collect::<Vec<_>>();

    if provider_tool_entries.is_empty() {
        return local;
    }

    let provider_to_local_anchors =
        map_provider_text_entries_to_local(&provider.entries, &local.entries);
    let mut seen_entry_ids = local
        .entries
        .iter()
        .map(|entry| entry.entry_id.clone())
        .collect::<HashSet<_>>();
    let mut insertions = Vec::new();

    for (provider_index, entry) in provider_tool_entries {
        if !seen_entry_ids.insert(entry.entry_id.clone()) {
            continue;
        }
        insertions.push((
            provider_tool_insert_index(
                provider_index,
                &provider_to_local_anchors,
                local.entries.len(),
            ),
            entry.clone(),
        ));
    }

    insertions.sort_by_key(|(index, _)| *index);
    for (offset, (index, entry)) in insertions.into_iter().enumerate() {
        local
            .entries
            .insert((index + offset).min(local.entries.len()), entry);
    }

    local
}

fn map_provider_text_entries_to_local(
    provider_entries: &[crate::acp::transcript_projection::TranscriptEntry],
    local_entries: &[crate::acp::transcript_projection::TranscriptEntry],
) -> Vec<Option<usize>> {
    let mut anchors = vec![None; provider_entries.len()];
    let mut next_local_index = 0;

    for (provider_index, provider_entry) in provider_entries.iter().enumerate() {
        if provider_entry.role == TranscriptEntryRole::Tool {
            continue;
        }

        let Some(local_index) = local_entries
            .iter()
            .enumerate()
            .skip(next_local_index)
            .find_map(|(local_index, local_entry)| {
                transcript_entries_have_same_visible_content(provider_entry, local_entry)
                    .then_some(local_index)
            })
        else {
            continue;
        };

        anchors[provider_index] = Some(local_index);
        next_local_index = local_index + 1;
    }

    anchors
}

fn provider_tool_insert_index(
    provider_index: usize,
    anchors: &[Option<usize>],
    local_len: usize,
) -> usize {
    if let Some(previous_index) = anchors[..provider_index]
        .iter()
        .rev()
        .find_map(|index| *index)
    {
        return previous_index + 1;
    }

    anchors
        .iter()
        .skip(provider_index + 1)
        .find_map(|index| *index)
        .unwrap_or(local_len)
}

fn transcript_entries_have_same_visible_content(
    left: &crate::acp::transcript_projection::TranscriptEntry,
    right: &crate::acp::transcript_projection::TranscriptEntry,
) -> bool {
    left.role == right.role
        && transcript_segment_texts(&left.segments) == transcript_segment_texts(&right.segments)
}

fn transcript_segment_texts(segments: &[TranscriptSegment]) -> Vec<&str> {
    segments
        .iter()
        .map(|segment| segment.primary_text())
        .collect()
}
