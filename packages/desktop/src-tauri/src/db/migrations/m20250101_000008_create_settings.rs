use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Create api_keys table
        manager
            .create_table(
                Table::create()
                    .table(ApiKeys::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ApiKeys::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ApiKeys::ProviderId)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(ApiKeys::KeyName).string().not_null())
                    .col(ColumnDef::new(ApiKeys::Value).string().not_null())
                    .col(ColumnDef::new(ApiKeys::CreatedAt).date_time().not_null())
                    .col(ColumnDef::new(ApiKeys::UpdatedAt).date_time().not_null())
                    .to_owned(),
            )
            .await?;

        // Create unique index on provider_id
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_api_keys_provider_id")
                    .table(ApiKeys::Table)
                    .col(ApiKeys::ProviderId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Create user_keybindings table
        manager
            .create_table(
                Table::create()
                    .table(UserKeybindings::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(UserKeybindings::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(UserKeybindings::Key).string().not_null())
                    .col(ColumnDef::new(UserKeybindings::Command).string().not_null())
                    .col(ColumnDef::new(UserKeybindings::When).string().null())
                    .col(
                        ColumnDef::new(UserKeybindings::Source)
                            .string()
                            .not_null()
                            .default("user"),
                    )
                    .col(
                        ColumnDef::new(UserKeybindings::CreatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(UserKeybindings::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Create unique index on key+command combination
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_user_keybindings_key_command")
                    .table(UserKeybindings::Table)
                    .col(UserKeybindings::Key)
                    .col(UserKeybindings::Command)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Create index on command for lookups
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_user_keybindings_command")
                    .table(UserKeybindings::Table)
                    .col(UserKeybindings::Command)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(UserKeybindings::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ApiKeys::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ApiKeys {
    Table,
    Id,
    ProviderId,
    KeyName,
    Value,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum UserKeybindings {
    Table,
    Id,
    Key,
    Command,
    When,
    Source,
    CreatedAt,
    UpdatedAt,
}
