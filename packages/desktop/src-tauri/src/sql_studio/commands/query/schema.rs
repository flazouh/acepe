use std::collections::BTreeMap;

use rusqlite::Connection;
use sea_orm::DbConn;
use sqlx::Row;
use tauri::State;

use crate::db::repository::SqlStudioRepository;

use super::super::super::types::{ColumnNode, SchemaNode, TableNode};
use super::super::helpers::{connect_mysql, connect_postgres, connect_s3, get_sqlite_file_path};

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_list_schema(
    db: State<'_, DbConn>,
    id: String,
) -> Result<Vec<SchemaNode>, String> {
    let connection = SqlStudioRepository::get_connection(&db, &id)
        .await
        .map_err(|e| format!("Failed to load SQL connection: {}", e))?
        .ok_or_else(|| format!("Connection not found: {}", id))?;

    match connection.engine.as_str() {
        "sqlite" => {
            let file_path = get_sqlite_file_path(&connection)?;
            let conn = Connection::open(file_path)
                .map_err(|e| format!("Failed to open SQLite connection: {}", e))?;

            let mut table_stmt = conn
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                )
                .map_err(|e| format!("Failed to load tables: {}", e))?;

            let table_names = table_stmt
                .query_map([], |row| row.get::<usize, String>(0))
                .map_err(|e| format!("Failed to query tables: {}", e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to parse table names: {}", e))?;

            let tables = table_names
                .into_iter()
                .map(|table_name| {
                    let escaped_name = table_name.replace('\'', "''");
                    let pragma = format!("PRAGMA table_info('{}')", escaped_name);
                    let mut col_stmt = conn.prepare(&pragma).map_err(|e| {
                        format!("Failed to prepare PRAGMA for table '{}': {}", table_name, e)
                    })?;

                    let raw_columns = col_stmt
                        .query_map([], |row| {
                            Ok(ColumnNode {
                                name: row.get::<usize, String>(1)?,
                                data_type: row.get::<usize, String>(2)?,
                                nullable: row.get::<usize, i64>(3)? == 0,
                                is_primary_key: row.get::<usize, i64>(5)? > 0,
                            })
                        })
                        .map_err(|e| {
                            format!("Failed to load columns for table '{}': {}", table_name, e)
                        })?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| {
                            format!("Failed to parse columns for table '{}': {}", table_name, e)
                        })?;

                    let primary_key_columns = raw_columns
                        .iter()
                        .filter(|column| column.is_primary_key)
                        .map(|column| column.name.clone())
                        .collect::<Vec<_>>();

                    Ok(TableNode {
                        name: table_name,
                        schema: "main".to_string(),
                        columns: raw_columns,
                        primary_key_columns,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;

            Ok(vec![SchemaNode {
                name: "main".to_string(),
                tables,
            }])
        }
        "postgres" => {
            let pool = connect_postgres(&connection).await?;
            let table_rows = sqlx::query(
                "SELECT table_schema, table_name
                 FROM information_schema.tables
                 WHERE table_type = 'BASE TABLE'
                   AND table_schema NOT IN ('pg_catalog', 'information_schema')
                 ORDER BY table_schema, table_name",
            )
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("Failed to load Postgres tables: {}", e))?;

            let mut schema_map: BTreeMap<String, Vec<TableNode>> = BTreeMap::new();

            for table_row in table_rows {
                let schema_name = table_row
                    .try_get::<String, _>("table_schema")
                    .map_err(|e| format!("Failed to read Postgres table schema: {}", e))?;
                let table_name = table_row
                    .try_get::<String, _>("table_name")
                    .map_err(|e| format!("Failed to read Postgres table name: {}", e))?;

                let columns_rows = sqlx::query(
                    "SELECT c.column_name, c.data_type, c.is_nullable,
                            EXISTS (
                                SELECT 1
                                FROM information_schema.table_constraints tc
                                JOIN information_schema.key_column_usage kcu
                                  ON tc.constraint_name = kcu.constraint_name
                                 AND tc.table_schema = kcu.table_schema
                                 AND tc.table_name = kcu.table_name
                                WHERE tc.constraint_type = 'PRIMARY KEY'
                                  AND tc.table_schema = c.table_schema
                                  AND tc.table_name = c.table_name
                                  AND kcu.column_name = c.column_name
                            ) AS is_primary_key
                     FROM information_schema.columns c
                     WHERE c.table_schema = $1 AND c.table_name = $2
                     ORDER BY c.ordinal_position",
                )
                .bind(&schema_name)
                .bind(&table_name)
                .fetch_all(&pool)
                .await
                .map_err(|e| {
                    format!(
                        "Failed to load Postgres columns for {}.{}: {}",
                        schema_name, table_name, e
                    )
                })?;

                let columns =
                    columns_rows
                        .into_iter()
                        .map(|column_row| {
                            let nullable = column_row
                                .try_get::<String, _>("is_nullable")
                                .map(|value| value == "YES")
                                .map_err(|e| {
                                    format!("Failed reading Postgres column nullability: {}", e)
                                })?;

                            Ok(ColumnNode {
                                name: column_row.try_get::<String, _>("column_name").map_err(
                                    |e| format!("Failed reading Postgres column name: {}", e),
                                )?,
                                data_type: column_row.try_get::<String, _>("data_type").map_err(
                                    |e| format!("Failed reading Postgres data type: {}", e),
                                )?,
                                nullable,
                                is_primary_key: column_row
                                    .try_get::<bool, _>("is_primary_key")
                                    .map_err(|e| {
                                        format!("Failed reading Postgres primary key marker: {}", e)
                                    })?,
                            })
                        })
                        .collect::<Result<Vec<_>, String>>()?;

                let primary_key_columns = columns
                    .iter()
                    .filter(|column| column.is_primary_key)
                    .map(|column| column.name.clone())
                    .collect::<Vec<_>>();

                schema_map
                    .entry(schema_name.clone())
                    .or_default()
                    .push(TableNode {
                        name: table_name,
                        schema: schema_name,
                        columns,
                        primary_key_columns,
                    });
            }

            pool.close().await;
            Ok(schema_map
                .into_iter()
                .map(|(name, tables)| SchemaNode { name, tables })
                .collect())
        }
        "mysql" => {
            let pool = connect_mysql(&connection).await?;
            let table_rows = sqlx::query(
                "SELECT table_schema, table_name
                 FROM information_schema.tables
                 WHERE table_type = 'BASE TABLE'
                   AND table_schema = DATABASE()
                 ORDER BY table_name",
            )
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("Failed to load MySQL tables: {}", e))?;

            let mut schema_map: BTreeMap<String, Vec<TableNode>> = BTreeMap::new();

            for table_row in table_rows {
                let schema_name = table_row
                    .try_get::<String, _>("table_schema")
                    .map_err(|e| format!("Failed to read MySQL table schema: {}", e))?;
                let table_name = table_row
                    .try_get::<String, _>("table_name")
                    .map_err(|e| format!("Failed to read MySQL table name: {}", e))?;

                let columns_rows = sqlx::query(
                    "SELECT c.column_name, c.data_type, c.is_nullable,
                            CASE WHEN EXISTS (
                                SELECT 1
                                FROM information_schema.table_constraints tc
                                JOIN information_schema.key_column_usage kcu
                                  ON tc.constraint_name = kcu.constraint_name
                                 AND tc.table_schema = kcu.table_schema
                                 AND tc.table_name = kcu.table_name
                                WHERE tc.constraint_type = 'PRIMARY KEY'
                                  AND tc.table_schema = c.table_schema
                                  AND tc.table_name = c.table_name
                                  AND kcu.column_name = c.column_name
                            ) THEN 1 ELSE 0 END AS is_primary_key
                     FROM information_schema.columns c
                     WHERE c.table_schema = DATABASE() AND c.table_name = ?
                     ORDER BY c.ordinal_position",
                )
                .bind(&table_name)
                .fetch_all(&pool)
                .await
                .map_err(|e| {
                    format!(
                        "Failed to load MySQL columns for {}.{}: {}",
                        schema_name, table_name, e
                    )
                })?;

                let columns = columns_rows
                    .into_iter()
                    .map(|column_row| {
                        let nullable = column_row
                            .try_get::<String, _>("is_nullable")
                            .map(|value| value == "YES")
                            .map_err(|e| {
                                format!("Failed reading MySQL column nullability: {}", e)
                            })?;

                        Ok(ColumnNode {
                            name: column_row
                                .try_get::<String, _>("column_name")
                                .map_err(|e| format!("Failed reading MySQL column name: {}", e))?,
                            data_type: column_row
                                .try_get::<String, _>("data_type")
                                .map_err(|e| format!("Failed reading MySQL data type: {}", e))?,
                            nullable,
                            is_primary_key: column_row
                                .try_get::<i64, _>("is_primary_key")
                                .map(|value| value > 0)
                                .map_err(|e| {
                                    format!("Failed reading MySQL primary key marker: {}", e)
                                })?,
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;

                let primary_key_columns = columns
                    .iter()
                    .filter(|column| column.is_primary_key)
                    .map(|column| column.name.clone())
                    .collect::<Vec<_>>();

                schema_map
                    .entry(schema_name.clone())
                    .or_default()
                    .push(TableNode {
                        name: table_name,
                        schema: schema_name,
                        columns,
                        primary_key_columns,
                    });
            }

            pool.close().await;
            Ok(schema_map
                .into_iter()
                .map(|(name, tables)| SchemaNode { name, tables })
                .collect())
        }
        "s3" => {
            let client = connect_s3(&connection).await?;
            let response = client
                .list_buckets()
                .send()
                .await
                .map_err(|e| format!("Failed to list S3 buckets: {}", e))?;

            let tables = response
                .buckets()
                .iter()
                .map(|bucket| TableNode {
                    name: bucket.name().unwrap_or_default().to_string(),
                    schema: "buckets".to_string(),
                    columns: vec![
                        ColumnNode {
                            name: "key".to_string(),
                            data_type: "string".to_string(),
                            nullable: false,
                            is_primary_key: true,
                        },
                        ColumnNode {
                            name: "size".to_string(),
                            data_type: "number".to_string(),
                            nullable: false,
                            is_primary_key: false,
                        },
                        ColumnNode {
                            name: "last_modified".to_string(),
                            data_type: "datetime".to_string(),
                            nullable: true,
                            is_primary_key: false,
                        },
                        ColumnNode {
                            name: "storage_class".to_string(),
                            data_type: "string".to_string(),
                            nullable: true,
                            is_primary_key: false,
                        },
                    ],
                    primary_key_columns: vec!["key".to_string()],
                })
                .collect::<Vec<_>>();

            Ok(vec![SchemaNode {
                name: "buckets".to_string(),
                tables,
            }])
        }
        engine => Err(format!("Unsupported database engine: {}", engine)),
    }
}
