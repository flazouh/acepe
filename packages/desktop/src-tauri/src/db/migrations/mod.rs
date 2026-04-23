use sea_orm_migration::prelude::*;

mod m20250101_000005_create_projects;
mod m20250101_000008_create_settings;
mod m20250101_000015_create_app_settings;
mod m20250108_000001_create_session_metadata;
mod m20250118_000001_create_skills_tables;
mod m20250130_000001_add_worktree_columns;
mod m20250131_000001_create_checkpoints;
mod m20250131_000002_add_unique_checkpoint_number;
mod m20250201_000001_add_file_snapshot_diff_stats;
mod m20260210_000001_create_sql_studio_tables;
mod m20260227_000001_add_sql_connection_config_fields;
mod m20260305_000001_create_session_review_state;
mod m20260318_000001_drop_worktree_dead_columns;
mod m20260318_000002_add_pr_number_to_session_metadata;
mod m20260329_000001_add_provider_session_id_to_session_metadata;
mod m20260405_000001_add_sequence_id_to_session_metadata;
mod m20260405_000002_add_acepe_managed_to_session_metadata;
mod m20260406_000001_create_acepe_session_state;
mod m20260408_000001_create_session_projection_snapshots;
mod m20260408_000002_create_session_journal_events;
mod m20260413_000001_add_project_sidebar_metadata;
mod m20260422_000001_remove_duplicate_session_truth;
mod m20260423_000001_create_missing_session_snapshot_tables;
mod m20260423_000002_add_pr_link_mode_to_acepe_session_state;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20250101_000005_create_projects::Migration),
            Box::new(m20250101_000008_create_settings::Migration),
            Box::new(m20250101_000015_create_app_settings::Migration),
            Box::new(m20250108_000001_create_session_metadata::Migration),
            Box::new(m20250118_000001_create_skills_tables::Migration),
            Box::new(m20250130_000001_add_worktree_columns::Migration),
            Box::new(m20250131_000001_create_checkpoints::Migration),
            Box::new(m20250131_000002_add_unique_checkpoint_number::Migration),
            Box::new(m20250201_000001_add_file_snapshot_diff_stats::Migration),
            Box::new(m20260210_000001_create_sql_studio_tables::Migration),
            Box::new(m20260227_000001_add_sql_connection_config_fields::Migration),
            Box::new(m20260305_000001_create_session_review_state::Migration),
            Box::new(m20260318_000001_drop_worktree_dead_columns::Migration),
            Box::new(m20260318_000002_add_pr_number_to_session_metadata::Migration),
            Box::new(m20260329_000001_add_provider_session_id_to_session_metadata::Migration),
            Box::new(m20260405_000001_add_sequence_id_to_session_metadata::Migration),
            Box::new(m20260405_000002_add_acepe_managed_to_session_metadata::Migration),
            Box::new(m20260406_000001_create_acepe_session_state::Migration),
            Box::new(m20260408_000001_create_session_projection_snapshots::Migration),
            Box::new(m20260408_000002_create_session_journal_events::Migration),
            Box::new(m20260413_000001_add_project_sidebar_metadata::Migration),
            Box::new(m20260422_000001_remove_duplicate_session_truth::Migration),
            Box::new(m20260423_000001_create_missing_session_snapshot_tables::Migration),
            Box::new(m20260423_000002_add_pr_link_mode_to_acepe_session_state::Migration),
        ]
    }
}
