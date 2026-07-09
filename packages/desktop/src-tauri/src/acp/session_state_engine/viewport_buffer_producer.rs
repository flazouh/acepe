use crate::acp::session_state_engine::protocol::ViewportBufferDelta;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::transcript_viewport::TranscriptViewportRow;
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PriorBufferEmission {
    pub row_ids: Vec<String>,
    pub row_versions: Vec<String>,
    pub budget_shrunk_tail: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferEmission {
    FreshPush,
    Delta,
    NoOp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowsDeltaParts {
    pub prepended_rows: Vec<TranscriptViewportRow>,
    pub appended_rows: Vec<TranscriptViewportRow>,
    pub removed_row_ids: Vec<String>,
}

#[must_use]
pub fn decide_buffer_emission(
    prev: Option<&PriorBufferEmission>,
    current_rows: &[TranscriptViewportRow],
    force_fresh: bool,
) -> BufferEmission {
    if force_fresh || prev.is_none() {
        return BufferEmission::FreshPush;
    }
    let prev = prev.expect("checked above");
    if rows_match_prior(prev, current_rows) {
        return BufferEmission::NoOp;
    }
    if rows_end_with_budget_shrunk_tail_prior(prev, current_rows) {
        return BufferEmission::NoOp;
    }
    if compute_rows_delta_parts(prev, current_rows).is_some() {
        return BufferEmission::Delta;
    }
    BufferEmission::FreshPush
}

#[must_use]
pub fn prior_from_rows(rows: &[TranscriptViewportRow]) -> PriorBufferEmission {
    PriorBufferEmission {
        row_ids: rows.iter().map(|row| row.row_id.clone()).collect(),
        row_versions: rows.iter().map(|row| row.version.clone()).collect(),
        budget_shrunk_tail: false,
    }
}

#[must_use]
pub fn prior_from_budget_shrunk_tail_rows(rows: &[TranscriptViewportRow]) -> PriorBufferEmission {
    PriorBufferEmission {
        row_ids: rows.iter().map(|row| row.row_id.clone()).collect(),
        row_versions: rows.iter().map(|row| row.version.clone()).collect(),
        budget_shrunk_tail: true,
    }
}

#[must_use]
pub fn rows_match_prior(
    prev: &PriorBufferEmission,
    current_rows: &[TranscriptViewportRow],
) -> bool {
    prev.row_ids.len() == current_rows.len()
        && prev
            .row_ids
            .iter()
            .zip(current_rows)
            .all(|(id, row)| id == &row.row_id)
        && prev
            .row_versions
            .iter()
            .zip(current_rows)
            .all(|(version, row)| version == &row.version)
}

#[must_use]
pub fn rows_end_with_budget_shrunk_tail_prior(
    prev: &PriorBufferEmission,
    current_rows: &[TranscriptViewportRow],
) -> bool {
    if !prev.budget_shrunk_tail
        || prev.row_ids.is_empty()
        || prev.row_ids.len() > current_rows.len()
    {
        return false;
    }

    let start = current_rows.len() - prev.row_ids.len();
    prev.row_ids
        .iter()
        .zip(&prev.row_versions)
        .zip(&current_rows[start..])
        .all(|((row_id, version), row)| row_id == &row.row_id && version == &row.version)
}

#[must_use]
pub fn compute_rows_delta(
    session_id: &str,
    graph_revision: SessionGraphRevision,
    emission_seq: u64,
    prev: &PriorBufferEmission,
    current_rows: &[TranscriptViewportRow],
) -> Option<ViewportBufferDelta> {
    let parts = compute_rows_delta_parts(prev, current_rows)?;
    Some(ViewportBufferDelta {
        session_id: session_id.to_string(),
        graph_revision,
        emission_seq,
        prepended_rows: parts.prepended_rows,
        appended_rows: parts.appended_rows,
        removed_row_ids: parts.removed_row_ids,
        diagnostics: Vec::new(),
    })
}

#[must_use]
pub fn compute_rows_delta_parts(
    prev: &PriorBufferEmission,
    current_rows: &[TranscriptViewportRow],
) -> Option<RowsDeltaParts> {
    if prev.row_ids.is_empty() {
        return Some(RowsDeltaParts {
            prepended_rows: Vec::new(),
            appended_rows: current_rows.to_vec(),
            removed_row_ids: Vec::new(),
        });
    }
    if current_rows.is_empty() {
        return Some(RowsDeltaParts {
            prepended_rows: Vec::new(),
            appended_rows: Vec::new(),
            removed_row_ids: prev.row_ids.clone(),
        });
    }
    if prev.budget_shrunk_tail {
        return compute_budget_shrunk_tail_delta_parts(prev, current_rows);
    }

    let previous_ids: HashSet<&str> = prev.row_ids.iter().map(String::as_str).collect();
    let first_existing = current_rows
        .iter()
        .position(|row| previous_ids.contains(row.row_id.as_str()))?;
    let last_existing = current_rows
        .iter()
        .rposition(|row| previous_ids.contains(row.row_id.as_str()))?;

    let prepended_rows = current_rows[..first_existing].to_vec();
    let appended_rows = current_rows[last_existing + 1..].to_vec();
    let middle_rows = &current_rows[first_existing..=last_existing];
    let middle_ids: HashSet<&str> = middle_rows.iter().map(|row| row.row_id.as_str()).collect();
    let removed_row_ids: Vec<String> = prev
        .row_ids
        .iter()
        .filter(|row_id| !middle_ids.contains(row_id.as_str()))
        .cloned()
        .collect();

    let survivor_ids: Vec<&String> = prev
        .row_ids
        .iter()
        .filter(|row_id| middle_ids.contains(row_id.as_str()))
        .collect();
    if survivor_ids.len() != middle_rows.len() {
        return None;
    }

    for (previous_id, current_row) in survivor_ids.iter().zip(middle_rows) {
        if previous_id.as_str() != current_row.row_id.as_str() {
            return None;
        }
        let previous_index = prev
            .row_ids
            .iter()
            .position(|row_id| row_id == *previous_id)?;
        if prev.row_versions.get(previous_index)? != &current_row.version {
            return None;
        }
    }

    Some(RowsDeltaParts {
        prepended_rows,
        appended_rows,
        removed_row_ids,
    })
}

fn compute_budget_shrunk_tail_delta_parts(
    prev: &PriorBufferEmission,
    current_rows: &[TranscriptViewportRow],
) -> Option<RowsDeltaParts> {
    if prev.row_ids.is_empty() || prev.row_ids.len() > current_rows.len() {
        return None;
    }

    let prior_len = prev.row_ids.len();
    let start = current_rows
        .windows(prior_len)
        .position(|candidate_rows| rows_match_prior(prev, candidate_rows))?;

    Some(RowsDeltaParts {
        prepended_rows: Vec::new(),
        appended_rows: current_rows[start + prior_len..].to_vec(),
        removed_row_ids: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        compute_rows_delta_parts, decide_buffer_emission, prior_from_budget_shrunk_tail_rows,
        prior_from_rows, BufferEmission,
    };
    use crate::acp::transcript_projection::TranscriptEntryRole;
    use crate::acp::transcript_viewport::{
        TranscriptViewportRow, TranscriptViewportRowContent, TranscriptViewportRowKind,
    };

    fn row(row_id: &str, version: &str) -> TranscriptViewportRow {
        TranscriptViewportRow {
            row_id: row_id.to_string(),
            source_entry_id: row_id.to_string(),
            kind: TranscriptViewportRowKind::AssistantText,
            version: version.to_string(),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: Vec::new(),
            },
            duration_started_at_ms: None,
        }
    }

    #[test]
    fn identical_rows_emit_noop() {
        let rows = vec![row("row-1", "v1"), row("row-2", "v1")];
        let prior = prior_from_rows(&rows);
        assert_eq!(
            decide_buffer_emission(Some(&prior), &rows, false),
            BufferEmission::NoOp
        );
    }

    #[test]
    fn append_rows_emit_delta() {
        let previous = vec![row("row-1", "v1"), row("row-2", "v1")];
        let current = vec![row("row-1", "v1"), row("row-2", "v1"), row("row-3", "v1")];
        let prior = prior_from_rows(&previous);
        let parts = compute_rows_delta_parts(&prior, &current).expect("delta");
        assert_eq!(parts.prepended_rows.len(), 0);
        assert_eq!(parts.appended_rows, vec![row("row-3", "v1")]);
        assert!(parts.removed_row_ids.is_empty());
        assert_eq!(
            decide_buffer_emission(Some(&prior), &current, false),
            BufferEmission::Delta
        );
    }

    #[test]
    fn prepend_rows_emit_delta() {
        let previous = vec![row("row-2", "v1"), row("row-3", "v1")];
        let current = vec![row("row-1", "v1"), row("row-2", "v1"), row("row-3", "v1")];
        let prior = prior_from_rows(&previous);
        let parts = compute_rows_delta_parts(&prior, &current).expect("delta");
        assert_eq!(parts.prepended_rows, vec![row("row-1", "v1")]);
        assert!(parts.appended_rows.is_empty());
        assert!(parts.removed_row_ids.is_empty());
    }

    #[test]
    fn budget_shrunk_tail_matching_current_suffix_emits_noop() {
        let delivered_tail = vec![row("row-2", "v1"), row("row-3", "v1")];
        let current = vec![row("row-1", "v1"), row("row-2", "v1"), row("row-3", "v1")];
        let prior = prior_from_budget_shrunk_tail_rows(&delivered_tail);

        assert_eq!(
            decide_buffer_emission(Some(&prior), &current, false),
            BufferEmission::NoOp
        );
    }

    #[test]
    fn budget_shrunk_tail_version_change_forces_fresh_push() {
        let delivered_tail = vec![row("row-2", "v1"), row("row-3", "v1")];
        let current = vec![row("row-1", "v1"), row("row-2", "v1"), row("row-3", "v2")];
        let prior = prior_from_budget_shrunk_tail_rows(&delivered_tail);

        assert_eq!(
            decide_buffer_emission(Some(&prior), &current, false),
            BufferEmission::FreshPush
        );
    }

    #[test]
    fn budget_shrunk_tail_delta_ignores_undelivered_head() {
        let delivered_tail = vec![row("row-2", "v1"), row("row-3", "v1")];
        let current = vec![
            row("row-1", "v1"),
            row("row-2", "v1"),
            row("row-3", "v1"),
            row("row-4", "v1"),
        ];
        let prior = prior_from_budget_shrunk_tail_rows(&delivered_tail);
        let parts = compute_rows_delta_parts(&prior, &current).expect("delta");

        assert!(parts.prepended_rows.is_empty());
        assert_eq!(parts.appended_rows, vec![row("row-4", "v1")]);
        assert!(parts.removed_row_ids.is_empty());
        assert_eq!(
            decide_buffer_emission(Some(&prior), &current, false),
            BufferEmission::Delta
        );
    }

    #[test]
    fn survivor_version_change_forces_fresh_push() {
        let previous = vec![row("row-1", "v1"), row("row-2", "v1")];
        let current = vec![row("row-1", "v1"), row("row-2", "v2")];
        let prior = prior_from_rows(&previous);
        assert_eq!(
            decide_buffer_emission(Some(&prior), &current, false),
            BufferEmission::FreshPush
        );
    }

    #[test]
    fn middle_insert_forces_fresh_push() {
        let previous = vec![row("row-1", "v1"), row("row-3", "v1")];
        let current = vec![row("row-1", "v1"), row("row-2", "v1"), row("row-3", "v1")];
        let prior = prior_from_rows(&previous);
        assert_eq!(
            decide_buffer_emission(Some(&prior), &current, false),
            BufferEmission::FreshPush
        );
    }
}
