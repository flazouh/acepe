use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .name("idx_session_metadata_project_timestamp")
                    .table(SessionMetadata::Table)
                    .col(SessionMetadata::ProjectPath)
                    .col(SessionMetadata::Timestamp)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_session_metadata_project_timestamp")
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    ProjectPath,
    Timestamp,
}
