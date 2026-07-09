//! Migration to make completed session identities provider-canonical.

use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::Statement;

const PROVIDER_OWNED_CANONICAL: &str = "provider_owned_canonical";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_report_table(manager).await?;
        migrate_legacy_provider_aliases(manager.get_connection()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(SessionIdentityMigrationReport::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

async fn create_report_table(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(SessionIdentityMigrationReport::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(SessionIdentityMigrationReport::Id)
                        .integer()
                        .not_null()
                        .auto_increment()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(SessionIdentityMigrationReport::OldSessionId)
                        .string()
                        .null(),
                )
                .col(
                    ColumnDef::new(SessionIdentityMigrationReport::ProviderSessionId)
                        .string()
                        .null(),
                )
                .col(
                    ColumnDef::new(SessionIdentityMigrationReport::Status)
                        .string()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(SessionIdentityMigrationReport::Reason)
                        .string()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(SessionIdentityMigrationReport::CreatedAt)
                        .date_time()
                        .not_null()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

pub async fn migrate_legacy_provider_aliases<C>(db: &C) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    let backend = db.get_database_backend();
    db.execute_unprepared("PRAGMA defer_foreign_keys = ON")
        .await?;

    execute_sql(
        db,
        "INSERT INTO session_identity_migration_report (
            old_session_id,
            provider_session_id,
            status,
            reason
        )
        SELECT
            id,
            provider_session_id,
            'unresolved',
            'missing_provider_session_id'
        FROM session_metadata
        WHERE provider_identity_kind = 'legacy_provider_alias'
          AND (provider_session_id IS NULL OR provider_session_id = '')",
    )
    .await?;

    execute_sql(
        db,
        "INSERT INTO session_identity_migration_report (
            old_session_id,
            provider_session_id,
            status,
            reason
        )
        SELECT
            id,
            provider_session_id,
            'unresolved',
            'provider_id_already_exists'
        FROM session_metadata AS legacy
        WHERE legacy.provider_identity_kind = 'legacy_provider_alias'
          AND legacy.provider_session_id IS NOT NULL
          AND legacy.provider_session_id != ''
          AND EXISTS (
              SELECT 1
              FROM session_metadata AS existing
              WHERE existing.id = legacy.provider_session_id
                AND existing.id != legacy.id
          )",
    )
    .await?;

    execute_sql(
        db,
        "INSERT INTO session_identity_migration_report (
            old_session_id,
            provider_session_id,
            status,
            reason
        )
        SELECT
            id,
            provider_session_id,
            'unresolved',
            'duplicate_legacy_provider_id'
        FROM session_metadata AS legacy
        WHERE legacy.provider_identity_kind = 'legacy_provider_alias'
          AND legacy.provider_session_id IS NOT NULL
          AND legacy.provider_session_id != ''
          AND legacy.provider_session_id IN (
              SELECT provider_session_id
              FROM session_metadata
              WHERE provider_identity_kind = 'legacy_provider_alias'
                AND provider_session_id IS NOT NULL
                AND provider_session_id != ''
              GROUP BY provider_session_id
              HAVING COUNT(*) > 1
          )",
    )
    .await?;

    execute_sql(
        db,
        "CREATE TABLE IF NOT EXISTS legacy_provider_alias_migration_candidates (
            old_session_id TEXT PRIMARY KEY,
            new_session_id TEXT NOT NULL,
            sequence_id INTEGER NULL
        )",
    )
    .await?;
    execute_sql(db, "DELETE FROM legacy_provider_alias_migration_candidates").await?;
    execute_sql(
        db,
        "INSERT INTO legacy_provider_alias_migration_candidates (
            old_session_id,
            new_session_id,
            sequence_id
        )
        SELECT
            legacy.id,
            legacy.provider_session_id,
            legacy.sequence_id
        FROM session_metadata AS legacy
        WHERE legacy.provider_identity_kind = 'legacy_provider_alias'
          AND legacy.provider_session_id IS NOT NULL
          AND legacy.provider_session_id != ''
          AND NOT EXISTS (
              SELECT 1
              FROM session_metadata AS existing
              WHERE existing.id = legacy.provider_session_id
                AND existing.id != legacy.id
          )
           AND legacy.provider_session_id NOT IN (
               SELECT provider_session_id
               FROM session_metadata
               WHERE provider_identity_kind = 'legacy_provider_alias'
                AND provider_session_id IS NOT NULL
                AND provider_session_id != ''
               GROUP BY provider_session_id
               HAVING COUNT(*) > 1
           )
          AND legacy.file_path = '__session_registry__/' || legacy.id",
    )
    .await?;

    execute_sql(
        db,
        "UPDATE session_metadata
        SET sequence_id = NULL
        WHERE id IN (
            SELECT old_session_id
            FROM legacy_provider_alias_migration_candidates
        )",
    )
    .await?;

    execute_sql(
        db,
        "INSERT INTO session_metadata (
            id,
            display,
            timestamp,
            project_path,
            agent_id,
            file_path,
            file_mtime,
            file_size,
            created_at,
            updated_at,
            worktree_path,
            pr_number,
            sequence_id,
            is_acepe_managed,
            provider_session_id,
            provider_identity_kind
        )
        SELECT
            candidates.new_session_id,
            legacy.display,
            legacy.timestamp,
            legacy.project_path,
            legacy.agent_id,
            CASE
                WHEN legacy.file_path = '__session_registry__/' || legacy.id THEN
                    '__session_registry__/' || candidates.new_session_id
                ELSE legacy.file_path
            END,
            legacy.file_mtime,
            legacy.file_size,
            legacy.created_at,
            legacy.updated_at,
            legacy.worktree_path,
            legacy.pr_number,
            candidates.sequence_id,
            legacy.is_acepe_managed,
            NULL,
            'provider_owned_canonical'
        FROM session_metadata AS legacy
        JOIN legacy_provider_alias_migration_candidates AS candidates
          ON candidates.old_session_id = legacy.id",
    )
    .await?;

    rekey_session_reference(db, "acepe_session_state").await?;
    rekey_session_reference(db, "session_journal_event").await?;
    rekey_session_reference(db, "session_review_state").await?;
    rekey_session_reference(db, "checkpoints").await?;

    execute_sql(
        db,
        "DELETE FROM session_metadata
        WHERE id IN (
            SELECT old_session_id
            FROM legacy_provider_alias_migration_candidates
        )",
    )
    .await?;

    db.execute(Statement::from_string(
        backend,
        format!(
            "INSERT INTO session_identity_migration_report (
                old_session_id,
                provider_session_id,
                status,
                reason
            )
            SELECT
                old_session_id,
                new_session_id,
                'migrated',
                'rekeyed_to_provider_canonical'
            FROM legacy_provider_alias_migration_candidates
            WHERE EXISTS (
                SELECT 1
                FROM session_metadata
                WHERE session_metadata.id = legacy_provider_alias_migration_candidates.new_session_id
                  AND session_metadata.provider_identity_kind = '{PROVIDER_OWNED_CANONICAL}'
            )"
        ),
    ))
    .await?;

    execute_sql(db, "DROP TABLE legacy_provider_alias_migration_candidates").await?;

    Ok(())
}

async fn rekey_session_reference<C>(db: &C, table_name: &str) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    let escaped_table_name = table_name.replace('"', "\"\"");
    execute_sql(
        db,
        &format!(
            "UPDATE \"{escaped_table_name}\"
            SET session_id = (
                SELECT candidates.new_session_id
                FROM legacy_provider_alias_migration_candidates AS candidates
                WHERE candidates.old_session_id = \"{escaped_table_name}\".session_id
            )
            WHERE session_id IN (
                SELECT old_session_id
                FROM legacy_provider_alias_migration_candidates
            )"
        ),
    )
    .await
}

async fn execute_sql<C>(db: &C, sql: &str) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    db.execute(Statement::from_string(
        db.get_database_backend(),
        sql.to_string(),
    ))
    .await?;
    Ok(())
}

#[derive(DeriveIden)]
enum SessionIdentityMigrationReport {
    Table,
    Id,
    OldSessionId,
    ProviderSessionId,
    Status,
    Reason,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm_migration::sea_orm::{Database, DatabaseConnection};
    use sea_orm_migration::MigratorTrait;

    #[tokio::test]
    async fn migrates_legacy_alias_to_provider_canonical_identity() {
        let db = setup_test_db().await;

        seed_session(&db, "local-session", "__session_registry__/local-session").await;
        execute_sql(
            &db,
            "UPDATE session_metadata
             SET provider_session_id = 'provider-session',
                 provider_identity_kind = 'legacy_provider_alias'
             WHERE id = 'local-session'",
        )
        .await
        .expect("mark legacy alias");
        seed_reference_rows(&db, "local-session").await;

        migrate_legacy_provider_aliases(&db)
            .await
            .expect("migrate legacy aliases");

        assert_count(
            &db,
            "SELECT COUNT(*) AS count
             FROM session_metadata
             WHERE id = 'provider-session'
               AND provider_session_id IS NULL
               AND provider_identity_kind = 'provider_owned_canonical'
               AND file_path = '__session_registry__/provider-session'",
            1,
        )
        .await;
        assert_count(
            &db,
            "SELECT COUNT(*) AS count FROM session_metadata WHERE id = 'local-session'",
            0,
        )
        .await;
        assert_reference_rows(&db, "provider-session").await;
        assert_count(
            &db,
            "SELECT COUNT(*) AS count
             FROM session_identity_migration_report
             WHERE old_session_id = 'local-session'
               AND provider_session_id = 'provider-session'
               AND status = 'migrated'",
            1,
        )
        .await;
    }

    #[tokio::test]
    async fn leaves_missing_provider_id_as_unresolved() {
        let db = setup_test_db().await;

        seed_session(&db, "local-session", "__session_registry__/local-session").await;
        execute_sql(
            &db,
            "UPDATE session_metadata
             SET provider_session_id = NULL,
                 provider_identity_kind = 'legacy_provider_alias'
             WHERE id = 'local-session'",
        )
        .await
        .expect("mark unresolved legacy alias");

        migrate_legacy_provider_aliases(&db)
            .await
            .expect("migrate legacy aliases");

        assert_count(
            &db,
            "SELECT COUNT(*) AS count
             FROM session_metadata
             WHERE id = 'local-session'
               AND provider_identity_kind = 'legacy_provider_alias'",
            1,
        )
        .await;
        assert_count(
            &db,
            "SELECT COUNT(*) AS count
             FROM session_identity_migration_report
             WHERE old_session_id = 'local-session'
               AND status = 'unresolved'
               AND reason = 'missing_provider_session_id'",
            1,
        )
        .await;
    }

    #[tokio::test]
    async fn leaves_provider_id_conflict_as_unresolved() {
        let db = setup_test_db().await;

        seed_session(&db, "local-session", "__session_registry__/local-session").await;
        seed_session(
            &db,
            "provider-session",
            "__session_registry__/provider-session",
        )
        .await;
        execute_sql(
            &db,
            "UPDATE session_metadata
             SET provider_session_id = 'provider-session',
                 provider_identity_kind = 'legacy_provider_alias'
             WHERE id = 'local-session'",
        )
        .await
        .expect("mark conflicting legacy alias");

        migrate_legacy_provider_aliases(&db)
            .await
            .expect("migrate legacy aliases");

        assert_count(
            &db,
            "SELECT COUNT(*) AS count
             FROM session_metadata
             WHERE id = 'local-session'
               AND provider_identity_kind = 'legacy_provider_alias'",
            1,
        )
        .await;
        assert_count(
            &db,
            "SELECT COUNT(*) AS count
             FROM session_identity_migration_report
             WHERE old_session_id = 'local-session'
               AND status = 'unresolved'
               AND reason = 'provider_id_already_exists'",
            1,
        )
        .await;
    }

    async fn setup_test_db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("run migrations");
        execute_sql(
            &db,
            "ALTER TABLE session_metadata ADD COLUMN provider_session_id TEXT",
        )
        .await
        .expect("restore provider_session_id bridge column for migration test");
        execute_sql(
            &db,
            "ALTER TABLE session_metadata
             ADD COLUMN provider_identity_kind TEXT NOT NULL DEFAULT 'unknown'",
        )
        .await
        .expect("restore provider_identity_kind bridge column for migration test");
        db
    }

    async fn seed_session(db: &DatabaseConnection, session_id: &str, file_path: &str) {
        execute_sql(
            db,
            &format!(
                "INSERT INTO session_metadata (
                    id,
                    display,
                    timestamp,
                    project_path,
                    agent_id,
                    file_path,
                    file_mtime,
                    file_size,
                    created_at,
                    updated_at,
                    provider_identity_kind
                )
                VALUES (
                    '{session_id}',
                    'Session',
                    1704067200000,
                    '/Users/test/project',
                    'claude-code',
                    '{file_path}',
                    1704067200,
                    1024,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP,
                    'provider_owned_canonical'
                )"
            ),
        )
        .await
        .expect("seed session");
    }

    async fn seed_reference_rows(db: &DatabaseConnection, session_id: &str) {
        execute_sql(
            db,
            &format!(
                "INSERT INTO acepe_session_state (
                    session_id,
                    relationship,
                    project_path,
                    sequence_id,
                    created_at,
                    updated_at
                )
                VALUES (
                    '{session_id}',
                    'created',
                    '/Users/test/project',
                    2,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )"
            ),
        )
        .await
        .expect("seed acepe session state");
        execute_sql(
            db,
            &format!(
                "INSERT INTO session_journal_event (
                    event_id,
                    session_id,
                    event_seq,
                    event_kind,
                    event_json,
                    created_at
                )
                VALUES (
                    'event-1',
                    '{session_id}',
                    1,
                    'session_update',
                    '{{}}',
                    CURRENT_TIMESTAMP
                )"
            ),
        )
        .await
        .expect("seed journal event");
        execute_sql(
            db,
            &format!(
                "INSERT INTO session_review_state (
                    session_id,
                    state_json,
                    created_at,
                    updated_at
                )
                VALUES (
                    '{session_id}',
                    '{{}}',
                    1704067200000,
                    1704067200000
                )"
            ),
        )
        .await
        .expect("seed review state");
        execute_sql(
            db,
            &format!(
                "INSERT INTO checkpoints (
                    id,
                    session_id,
                    checkpoint_number,
                    name,
                    created_at,
                    is_auto
                )
                VALUES (
                    'checkpoint-1',
                    '{session_id}',
                    1,
                    'Checkpoint',
                    1704067200000,
                    1
                )"
            ),
        )
        .await
        .expect("seed checkpoint");
    }

    async fn assert_reference_rows(db: &DatabaseConnection, session_id: &str) {
        assert_count(
            db,
            &format!("SELECT COUNT(*) AS count FROM acepe_session_state WHERE session_id = '{session_id}'"),
            1,
        )
        .await;
        assert_count(
            db,
            &format!("SELECT COUNT(*) AS count FROM session_journal_event WHERE session_id = '{session_id}'"),
            1,
        )
        .await;
        assert_count(
            db,
            &format!("SELECT COUNT(*) AS count FROM session_review_state WHERE session_id = '{session_id}'"),
            1,
        )
        .await;
        assert_count(
            db,
            &format!("SELECT COUNT(*) AS count FROM checkpoints WHERE session_id = '{session_id}'"),
            1,
        )
        .await;
    }

    async fn assert_count(db: &DatabaseConnection, sql: &str, expected_count: i64) {
        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                sql.to_string(),
            ))
            .await
            .expect("query count")
            .expect("count row");
        let count = row.try_get::<i64>("", "count").expect("read count");
        assert_eq!(count, expected_count);
    }
}
