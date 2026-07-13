//! Live≡history fold replay invariants.

use crate::acp::session::engine::fold::{fold_full, fold_step, fold_step_with_dedup, FoldContext};
use crate::acp::session::engine::fold_lifecycle::apply_historical_close;
use crate::acp::session::engine::persisted_region::{
    extract_persisted_region, persisted_regions_equal,
};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::types::CanonicalAgentId;

fn sample_events() -> Vec<ProviderEvent> {
    vec![
        ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq: 1,
            provider_row_id: "user-1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::UserText {
                text: "first user".to_string(),
                attempt_id: None,
            },
        },
        ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq: 2,
            provider_row_id: "assistant-1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::AssistantText {
                text: "assistant reply".to_string(),
            },
        },
        ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq: 3,
            provider_row_id: "user-2".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::UserText {
                text: "second user".to_string(),
                attempt_id: None,
            },
        },
    ]
}

#[test]
fn fold_full_equals_sequential_fold_step_replay() {
    let events = sample_events();
    let ctx = FoldContext::new("replay-test", CanonicalAgentId::Cursor, "/tmp");

    let full = fold_full(&events, &ctx);

    let step = {
        let mut graph = fold_full(&[], &ctx);
        for event in &events {
            graph = fold_step(&graph, event).0;
        }
        apply_historical_close(&mut graph);
        graph
    };

    assert!(
        persisted_regions_equal(
            &extract_persisted_region(&full),
            &extract_persisted_region(&step),
        ),
        "fold_full and sequential fold_step replay must produce equal persisted regions"
    );
}

#[test]
fn fold_step_idempotent_on_same_provider_row_id_and_kind() {
    let ctx = FoldContext::new("idempotent-test", CanonicalAgentId::Cursor, "/tmp");
    let event = ProviderEvent {
        source: CanonicalAgentId::Cursor,
        provider_seq: 1,
        provider_row_id: "user-1".to_string(),
        timestamp_ms: None,
        kind: ProviderEventKind::UserText {
            text: "hello".to_string(),
            attempt_id: None,
        },
    };

    let empty = fold_full(&[], &ctx);
    let mut dedup = Some(std::collections::HashSet::new());
    let graph_once = fold_step_with_dedup(&empty, &event, &mut dedup).0;
    let graph_twice = fold_step_with_dedup(&graph_once, &event, &mut dedup).0;

    assert!(
        persisted_regions_equal(
            &extract_persisted_region(&graph_once),
            &extract_persisted_region(&graph_twice),
        ),
        "re-applying same provider_row_id+kind event must not duplicate transcript entries"
    );
    assert_eq!(graph_twice.transcript_snapshot.entries.len(), 1);
}
