//! Migration to create unified skills library tables.
//!
//! This migration creates tables for the unified skills management system:
//! - skills: Source of truth for all skill content
//! - skill_sync_targets: Which agents each skill syncs to
//! - skill_sync_history: Track what's been deployed to each agent

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Create skills table (source of truth)
        manager
            .create_table(
                Table::create()
                    .table(Skills::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Skills::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Skills::Name).string().not_null())
                    .col(ColumnDef::new(Skills::Description).string())
                    .col(ColumnDef::new(Skills::Content).text().not_null())
                    .col(ColumnDef::new(Skills::Category).string())
                    .col(ColumnDef::new(Skills::CreatedAt).integer().not_null())
                    .col(ColumnDef::new(Skills::UpdatedAt).integer().not_null())
                    .to_owned(),
            )
            .await?;

        // Create indexes on skills table
        manager
            .create_index(
                Index::create()
                    .name("idx_skills_name")
                    .table(Skills::Table)
                    .col(Skills::Name)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_skills_category")
                    .table(Skills::Table)
                    .col(Skills::Category)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_skills_updated")
                    .table(Skills::Table)
                    .col(Skills::UpdatedAt)
                    .to_owned(),
            )
            .await?;

        // Create skill_sync_targets table
        manager
            .create_table(
                Table::create()
                    .table(SkillSyncTargets::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SkillSyncTargets::SkillId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SkillSyncTargets::AgentId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SkillSyncTargets::Enabled)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .primary_key(
                        Index::create()
                            .col(SkillSyncTargets::SkillId)
                            .col(SkillSyncTargets::AgentId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_skill_sync_targets_skill_id")
                            .from(SkillSyncTargets::Table, SkillSyncTargets::SkillId)
                            .to(Skills::Table, Skills::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Create skill_sync_history table
        manager
            .create_table(
                Table::create()
                    .table(SkillSyncHistory::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SkillSyncHistory::SkillId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SkillSyncHistory::AgentId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SkillSyncHistory::SyncedAt)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SkillSyncHistory::ContentHash)
                            .string()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(SkillSyncHistory::SkillId)
                            .col(SkillSyncHistory::AgentId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_skill_sync_history_skill_id")
                            .from(SkillSyncHistory::Table, SkillSyncHistory::SkillId)
                            .to(Skills::Table, Skills::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SkillSyncHistory::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SkillSyncTargets::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Skills::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Skills {
    Table,
    Id,
    Name,
    Description,
    Content,
    Category,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SkillSyncTargets {
    Table,
    SkillId,
    AgentId,
    Enabled,
}

#[derive(DeriveIden)]
enum SkillSyncHistory {
    Table,
    SkillId,
    AgentId,
    SyncedAt,
    ContentHash,
}
