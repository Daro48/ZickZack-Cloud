import time
from database import get_database_connection

MEDIA_TABLES = ("photos", "videos")
STARTUP_RETRIES = 10
STARTUP_RETRY_DELAY_SECONDS = 2.0


def column_info(cursor, table, column):
    cursor.execute(
        """
        SELECT IS_NULLABLE AS is_nullable
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table, column),
    )
    return cursor.fetchone()


def index_exists(cursor, table, index_name):
    cursor.execute(
        """
        SELECT COUNT(*) AS hits
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        """,
        (table, index_name),
    )
    return bool(cursor.fetchone()["hits"])


def table_exists(cursor, table):
    cursor.execute(
        """
        SELECT COUNT(*) AS hits
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
        """,
        (table,),
    )
    return bool(cursor.fetchone()["hits"])


def ensure_session_expiry_index(cursor):
    """Ohne den Index scannt das Session-Aufräumen die ganze Tabelle."""
    if index_exists(cursor, "sessions", "idx_sessions_expires_at"):
        return
    cursor.execute("CREATE INDEX idx_sessions_expires_at ON sessions (expires_at)")
    print("[schema] Index idx_sessions_expires_at angelegt.")


def ensure_folder_column(cursor, table):
    """Ordnername als eigene, indexierbare Spalte statt als Präfix von stored_path.

    Der Backfill läuft nur solange die Spalte NULL erlaubt, danach ist die
    Migration abgeschlossen und jeder weitere Start überspringt sie.
    """
    info = column_info(cursor, table, "folder")

    if info is None:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN folder VARCHAR(64) NULL")
        info = {"is_nullable": "YES"}
        print(f"[schema] {table}: Spalte folder angelegt.")

    if info["is_nullable"] == "YES":
        cursor.execute(
            f"""
            UPDATE {table}
            SET folder = SUBSTRING_INDEX(SUBSTRING_INDEX(stored_path, '/', 2), '/', -1)
            WHERE folder IS NULL
            """
        )
        filled = cursor.rowcount
        cursor.execute(f"ALTER TABLE {table} MODIFY folder VARCHAR(64) NOT NULL")
        print(f"[schema] {table}: folder für {filled} Zeile(n) aus stored_path gefüllt.")

    index_name = f"idx_{table}_user_folder_created"
    if not index_exists(cursor, table, index_name):
        cursor.execute(
            f"CREATE INDEX {index_name} ON {table} (user_id, folder, created_at)"
        )
        print(f"[schema] {table}: Index {index_name} angelegt.")


def ensure_share_tables(cursor):
    """Freigaben sind nur Verweise auf vorhandene Dateien, keine Kopien."""
    if not table_exists(cursor, "shares"):
        cursor.execute(
            """
            CREATE TABLE shares (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                owner_id INT UNSIGNED NOT NULL,
                kind ENUM('folder', 'items') NOT NULL,
                folder VARCHAR(64) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id)
                    REFERENCES users(id)
                    ON DELETE CASCADE,
                INDEX idx_shares_owner_created (owner_id, created_at),
                INDEX idx_shares_owner_folder (owner_id, kind, folder)
            )
            """
        )
        print("[schema] Tabelle shares angelegt.")

    if not table_exists(cursor, "share_recipients"):
        cursor.execute(
            """
            CREATE TABLE share_recipients (
                share_id BIGINT UNSIGNED NOT NULL,
                user_id INT UNSIGNED NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (share_id, user_id),
                FOREIGN KEY (share_id)
                    REFERENCES shares(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (user_id)
                    REFERENCES users(id)
                    ON DELETE CASCADE,
                INDEX idx_share_recipients_user (user_id)
            )
            """
        )
        print("[schema] Tabelle share_recipients angelegt.")

    if not table_exists(cursor, "share_items"):
        cursor.execute(
            """
            CREATE TABLE share_items (
                share_id BIGINT UNSIGNED NOT NULL,
                media_type ENUM('photo', 'video') NOT NULL,
                media_id BIGINT UNSIGNED NOT NULL,
                PRIMARY KEY (share_id, media_type, media_id),
                FOREIGN KEY (share_id)
                    REFERENCES shares(id)
                    ON DELETE CASCADE,
                INDEX idx_share_items_media (media_type, media_id)
            )
            """
        )
        print("[schema] Tabelle share_items angelegt.")


def apply_migrations(connection):
    with connection.cursor() as cursor:
        ensure_session_expiry_index(cursor)
        for table in MEDIA_TABLES:
            ensure_folder_column(cursor, table)
        ensure_share_tables(cursor)
    connection.commit()


def run_startup_migrations():
    last_error = None

    for attempt in range(1, STARTUP_RETRIES + 1):
        connection = None
        try:
            connection = get_database_connection()
            apply_migrations(connection)
            print("[schema] Schema ist aktuell.")
            return True
        except Exception as error:
            last_error = error
            print(f"[schema] Migration fehlgeschlagen (Versuch {attempt}): {error}")
            time.sleep(STARTUP_RETRY_DELAY_SECONDS)
        finally:
            if connection is not None:
                connection.close()

    print(f"[schema] Migrationen konnten nicht angewendet werden: {last_error}")
    return False
