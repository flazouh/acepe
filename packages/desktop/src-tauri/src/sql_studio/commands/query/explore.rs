use crate::commands::observability::{CommandResult, unexpected_command_result};
use rusqlite::Connection;
use sea_orm::DbConn;
use tauri::State;

use crate::db::repository::SqlStudioRepository;

use super::super::super::types::{ExploreTableRequest, ExploreTableResponse};
use super::super::helpers::{
    build_qualified_table_name, connect_mysql, connect_postgres, get_sqlite_file_path,
    list_mysql_columns, list_postgres_columns, mysql_cell_to_string, normalize_explorer_window,
    pg_cell_to_string, require_field, sqlite_value_to_string,
};

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_explore_table(
    db: State<'_, DbConn>,
    request: ExploreTableRequest,
) -> CommandResult<ExploreTableResponse> {
    unexpected_command_result("sql_studio_explore_table", "Failed to explore SQL table", async {
        let connection = SqlStudioRepository::get_connection(&db, &request.connection_id)
            .await
            .map_err(|e| format!("Failed to load SQL connection: {}", e))?
            .ok_or_else(|| format!("Connection not found: {}", request.connection_id))?;

        let (safe_offset, safe_limit) = normalize_explorer_window(request.offset, request.limit);
        let fetch_limit = safe_limit + 1;

        match connection.engine.as_str() {
            "sqlite" => {
                let file_path = get_sqlite_file_path(&connection)?;
                let conn = Connection::open(file_path)
                    .map_err(|e| format!("Failed to open SQLite connection: {}", e))?;
                let qualified_table =
                    build_qualified_table_name("sqlite", &request.schema_name, &request.table_name);
                let sql = format!(
                    "SELECT * FROM {} LIMIT {} OFFSET {}",
                    qualified_table, fetch_limit, safe_offset
                );

                let mut stmt = conn
                    .prepare(&sql)
                    .map_err(|e| format!("Failed to prepare SQLite explorer query: {}", e))?;

                let columns = stmt
                    .column_names()
                    .iter()
                    .map(|name| (*name).to_string())
                    .collect::<Vec<_>>();

                let mut rows_cursor = stmt
                    .query([])
                    .map_err(|e| format!("Failed to execute SQLite explorer query: {}", e))?;
                let mut rows = Vec::new();

                while let Some(row) = rows_cursor
                    .next()
                    .map_err(|e| format!("Failed reading SQLite explorer rows: {}", e))?
                {
                    let values = (0..columns.len())
                        .map(|idx| {
                            row.get_ref(idx).map(sqlite_value_to_string).map_err(|e| {
                                format!("Failed reading SQLite explorer column {}: {}", idx, e)
                            })
                        })
                        .collect::<Result<Vec<_>, String>>()?;
                    rows.push(values);
                }

                let has_more = rows.len() as i64 > safe_limit;
                if has_more {
                    rows.truncate(safe_limit as usize);
                }

                Ok(ExploreTableResponse {
                    columns,
                    row_count_loaded: rows.len() as i64,
                    next_offset: if has_more {
                        Some(safe_offset + safe_limit)
                    } else {
                        None
                    },
                    rows,
                })
            }
            "postgres" => {
                let pool = connect_postgres(&connection).await?;
                let columns =
                    list_postgres_columns(&pool, &request.schema_name, &request.table_name).await?;
                let qualified_table =
                    build_qualified_table_name("postgres", &request.schema_name, &request.table_name);
                let sql = format!(
                    "SELECT * FROM {} LIMIT {} OFFSET {}",
                    qualified_table, fetch_limit, safe_offset
                );

                let rows = sqlx::query(&sql)
                    .fetch_all(&pool)
                    .await
                    .map_err(|e| format!("Failed to execute Postgres explorer query: {}", e))?;

                let mut mapped_rows = rows
                    .iter()
                    .map(|row| {
                        (0..columns.len())
                            .map(|idx| pg_cell_to_string(row, idx))
                            .collect::<Vec<_>>()
                    })
                    .collect::<Vec<_>>();

                let has_more = mapped_rows.len() as i64 > safe_limit;
                if has_more {
                    mapped_rows.truncate(safe_limit as usize);
                }
                pool.close().await;

                Ok(ExploreTableResponse {
                    columns,
                    row_count_loaded: mapped_rows.len() as i64,
                    next_offset: if has_more {
                        Some(safe_offset + safe_limit)
                    } else {
                        None
                    },
                    rows: mapped_rows,
                })
            }
            "mysql" => {
                let pool = connect_mysql(&connection).await?;
                let schema_name = if request.schema_name.trim().is_empty() {
                    require_field(&connection.database_name, "database_name")?
                } else {
                    request.schema_name.clone()
                };
                let columns = list_mysql_columns(&pool, &schema_name, &request.table_name).await?;
                let qualified_table =
                    build_qualified_table_name("mysql", &schema_name, &request.table_name);
                let sql = format!(
                    "SELECT * FROM {} LIMIT {} OFFSET {}",
                    qualified_table, fetch_limit, safe_offset
                );

                let rows = sqlx::query(&sql)
                    .fetch_all(&pool)
                    .await
                    .map_err(|e| format!("Failed to execute MySQL explorer query: {}", e))?;

                let mut mapped_rows = rows
                    .iter()
                    .map(|row| {
                        (0..columns.len())
                            .map(|idx| mysql_cell_to_string(row, idx))
                            .collect::<Vec<_>>()
                    })
                    .collect::<Vec<_>>();

                let has_more = mapped_rows.len() as i64 > safe_limit;
                if has_more {
                    mapped_rows.truncate(safe_limit as usize);
                }
                pool.close().await;

                Ok(ExploreTableResponse {
                    columns,
                    row_count_loaded: mapped_rows.len() as i64,
                    next_offset: if has_more {
                        Some(safe_offset + safe_limit)
                    } else {
                        None
                    },
                    rows: mapped_rows,
                })
            }
            engine => Err(format!("Unsupported database engine: {}", engine)),
        }
    }.await)
}
