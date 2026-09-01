from flask import Blueprint, jsonify, request
from database import get_database_connection
from media import (
    MAX_FOLDER_PAGE_SIZE,
    count_folder_items,
    fetch_folder_page,
    parse_non_negative_int,
    serialize_and_prime,
)
from upload import list_user_folders, require_user, sanitize_folder_name

community_bp = Blueprint("community", __name__)

PREVIEW_LIMIT = 4
MAX_SHARE_ITEMS = 500


def format_created_at(value):
    if not value:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def user_can_access_shared_media(
    connection, viewer_id, owner_id, media_type, media_id, folder
):
    if viewer_id == owner_id:
        return True

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1
            FROM share_recipients
            INNER JOIN shares ON shares.id = share_recipients.share_id
            WHERE share_recipients.user_id = %s
              AND shares.owner_id = %s
              AND (
                (shares.kind = 'folder' AND shares.folder = %s)
                OR (
                    shares.kind = 'items'
                    AND EXISTS (
                        SELECT 1
                        FROM share_items
                        WHERE share_items.share_id = shares.id
                          AND share_items.media_type = %s
                          AND share_items.media_id = %s
                    )
                )
              )
            LIMIT 1
            """,
            (viewer_id, owner_id, folder, media_type, media_id),
        )
        return cursor.fetchone() is not None


def load_share_row(cursor, share_id):
    cursor.execute(
        """
        SELECT
            shares.id,
            shares.owner_id,
            shares.kind,
            shares.folder,
            shares.created_at,
            users.username AS owner_username
        FROM shares
        INNER JOIN users ON users.id = shares.owner_id
        WHERE shares.id = %s
        """,
        (share_id,),
    )
    return cursor.fetchone()


def viewer_can_see_share(cursor, share_id, viewer_id, owner_id):
    if owner_id == viewer_id:
        return True
    cursor.execute(
        """
        SELECT 1
        FROM share_recipients
        WHERE share_id = %s AND user_id = %s
        """,
        (share_id, viewer_id),
    )
    return cursor.fetchone() is not None


def load_recipients(cursor, share_id):
    cursor.execute(
        """
        SELECT users.id, users.username
        FROM share_recipients
        INNER JOIN users ON users.id = share_recipients.user_id
        WHERE share_recipients.share_id = %s
        ORDER BY users.username
        """,
        (share_id,),
    )
    return cursor.fetchall()


def count_share_items(cursor, share_id):
    cursor.execute(
        "SELECT COUNT(*) AS total FROM share_items WHERE share_id = %s",
        (share_id,),
    )
    return int((cursor.fetchone() or {}).get("total") or 0)


def fetch_share_items_page(cursor, share_id, owner_id, offset, limit):
    probe_limit = limit + 1
    branch_limit = offset + probe_limit
    cursor.execute(
        """
        SELECT
            id,
            type,
            original_name,
            stored_path,
            mime_type,
            size_bytes,
            created_at
        FROM (
            (
                SELECT
                    photos.id,
                    'photo' AS type,
                    photos.original_name,
                    photos.stored_path,
                    photos.mime_type,
                    photos.size_bytes,
                    photos.created_at
                FROM share_items
                INNER JOIN photos
                    ON photos.id = share_items.media_id
                   AND photos.user_id = %s
                WHERE share_items.share_id = %s
                  AND share_items.media_type = 'photo'
                ORDER BY photos.created_at DESC, photos.id DESC
                LIMIT %s
            )
            UNION ALL
            (
                SELECT
                    videos.id,
                    'video' AS type,
                    videos.original_name,
                    videos.stored_path,
                    videos.mime_type,
                    videos.size_bytes,
                    videos.created_at
                FROM share_items
                INNER JOIN videos
                    ON videos.id = share_items.media_id
                   AND videos.user_id = %s
                WHERE share_items.share_id = %s
                  AND share_items.media_type = 'video'
                ORDER BY videos.created_at DESC, videos.id DESC
                LIMIT %s
            )
        ) AS media
        ORDER BY created_at DESC, type ASC, id DESC
        LIMIT %s OFFSET %s
        """,
        (
            owner_id,
            share_id,
            branch_limit,
            owner_id,
            share_id,
            branch_limit,
            probe_limit,
            offset,
        ),
    )
    rows = cursor.fetchall()
    has_more = len(rows) > limit
    return rows[:limit], has_more


def hydrate_share(cursor, share, viewer_id):
    recipients = load_recipients(cursor, share["id"])
    owner_id = share["owner_id"]
    if share["kind"] == "folder":
        item_count = count_folder_items(cursor, owner_id, share["folder"])
        preview_rows, _ = fetch_folder_page(
            cursor, owner_id, share["folder"], 0, PREVIEW_LIMIT
        )
    else:
        item_count = count_share_items(cursor, share["id"])
        preview_rows, _ = fetch_share_items_page(
            cursor, share["id"], owner_id, 0, PREVIEW_LIMIT
        )

    return {
        "id": share["id"],
        "kind": share["kind"],
        "folder": share["folder"],
        "owner": {
            "id": owner_id,
            "username": share["owner_username"],
        },
        "recipients": [
            {"id": row["id"], "username": row["username"]} for row in recipients
        ],
        "item_count": item_count,
        "preview": serialize_and_prime(preview_rows, owner_id),
        "mine": owner_id == viewer_id,
        "created_at": format_created_at(share["created_at"]),
    }


def parse_recipient_ids(cursor, owner_id, data):
    cursor.execute(
        """
        SELECT id
        FROM users
        WHERE id != %s
        ORDER BY username
        """,
        (owner_id,),
    )
    others = [row["id"] for row in cursor.fetchall()]
    if data.get("all"):
        return others

    wanted = set()
    for value in data.get("user_ids") or []:
        try:
            user_id = int(value)
        except (TypeError, ValueError):
            continue
        if user_id > 0:
            wanted.add(user_id)

    allowed = set(others)
    return [user_id for user_id in others if user_id in wanted]


def parse_owned_items(cursor, owner_id, raw_items):
    wanted_photos = set()
    wanted_videos = set()

    for entry in raw_items or []:
        if not isinstance(entry, dict):
            continue
        media_type = entry.get("type")
        try:
            media_id = int(entry.get("id"))
        except (TypeError, ValueError):
            continue
        if media_id < 1:
            continue
        if media_type == "photo":
            wanted_photos.add(media_id)
        elif media_type == "video":
            wanted_videos.add(media_id)

    if len(wanted_photos) + len(wanted_videos) > MAX_SHARE_ITEMS:
        return None, "Zu viele Dateien auf einmal."

    owned = []

    if wanted_photos:
        placeholders = ", ".join(["%s"] * len(wanted_photos))
        cursor.execute(
            f"SELECT id FROM photos WHERE user_id = %s AND id IN ({placeholders})",
            (owner_id, *wanted_photos),
        )
        found = {row["id"] for row in cursor.fetchall()}
        if found != wanted_photos:
            return None, "Mindestens eine Datei gehört dir nicht."
        owned.extend(("photo", media_id) for media_id in sorted(found))

    if wanted_videos:
        placeholders = ", ".join(["%s"] * len(wanted_videos))
        cursor.execute(
            f"SELECT id FROM videos WHERE user_id = %s AND id IN ({placeholders})",
            (owner_id, *wanted_videos),
        )
        found = {row["id"] for row in cursor.fetchall()}
        if found != wanted_videos:
            return None, "Mindestens eine Datei gehört dir nicht."
        owned.extend(("video", media_id) for media_id in sorted(found))

    if not owned:
        return None, "Bitte Dateien zum Teilen markieren."

    return owned, None


def insert_recipients(cursor, share_id, recipient_ids):
    cursor.executemany(
        """
        INSERT IGNORE INTO share_recipients (share_id, user_id)
        VALUES (%s, %s)
        """,
        [(share_id, user_id) for user_id in recipient_ids],
    )


@community_bp.get("/bp/community/users")
def list_community_users():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, username
                FROM users
                WHERE id != %s
                ORDER BY username
                """,
                (user["id"],),
            )
            rows = cursor.fetchall()

        return jsonify(
            {
                "status": "ok",
                "users": [
                    {"id": row["id"], "username": row["username"]} for row in rows
                ],
            }
        )
    finally:
        connection.close()


@community_bp.get("/bp/community")
def list_community():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    shares.id,
                    shares.owner_id,
                    shares.kind,
                    shares.folder,
                    shares.created_at,
                    users.username AS owner_username
                FROM shares
                INNER JOIN share_recipients
                    ON share_recipients.share_id = shares.id
                INNER JOIN users ON users.id = shares.owner_id
                WHERE share_recipients.user_id = %s
                ORDER BY shares.created_at DESC, shares.id DESC
                """,
                (user["id"],),
            )
            incoming_rows = cursor.fetchall()

            cursor.execute(
                """
                SELECT
                    shares.id,
                    shares.owner_id,
                    shares.kind,
                    shares.folder,
                    shares.created_at,
                    users.username AS owner_username
                FROM shares
                INNER JOIN users ON users.id = shares.owner_id
                WHERE shares.owner_id = %s
                ORDER BY shares.created_at DESC, shares.id DESC
                """,
                (user["id"],),
            )
            outgoing_rows = cursor.fetchall()

            incoming = [
                hydrate_share(cursor, row, user["id"]) for row in incoming_rows
            ]
            outgoing = [
                hydrate_share(cursor, row, user["id"]) for row in outgoing_rows
            ]

        return jsonify(
            {
                "status": "ok",
                "incoming": incoming,
                "outgoing": outgoing,
            }
        )
    finally:
        connection.close()


@community_bp.post("/bp/community/shares")
def create_share():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        data = request.get_json(silent=True) or {}
        kind = data.get("kind")
        if kind not in {"folder", "items"}:
            return (
                jsonify({"status": "error", "message": "Ungültige Freigabe."}),
                400,
            )

        with connection.cursor() as cursor:
            recipient_ids = parse_recipient_ids(cursor, user["id"], data)
            if not recipient_ids:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "Bitte mindestens einen User wählen.",
                        }
                    ),
                    400,
                )

            if kind == "folder":
                folder_name = sanitize_folder_name(data.get("folder"))
                if not folder_name:
                    return (
                        jsonify(
                            {
                                "status": "error",
                                "message": "Bitte einen Ordner wählen.",
                            }
                        ),
                        400,
                    )
                if folder_name not in list_user_folders(user["username"]):
                    return (
                        jsonify(
                            {
                                "status": "error",
                                "message": "Dieser Ordner existiert nicht.",
                            }
                        ),
                        400,
                    )

                cursor.execute(
                    """
                    SELECT id
                    FROM shares
                    WHERE owner_id = %s AND kind = 'folder' AND folder = %s
                    """,
                    (user["id"], folder_name),
                )
                existing = cursor.fetchone()
                if existing:
                    share_id = existing["id"]
                    insert_recipients(cursor, share_id, recipient_ids)
                else:
                    cursor.execute(
                        """
                        INSERT INTO shares (owner_id, kind, folder)
                        VALUES (%s, 'folder', %s)
                        """,
                        (user["id"], folder_name),
                    )
                    share_id = cursor.lastrowid
                    insert_recipients(cursor, share_id, recipient_ids)
            else:
                owned, error_message = parse_owned_items(
                    cursor, user["id"], data.get("items")
                )
                if error_message:
                    return jsonify({"status": "error", "message": error_message}), 400

                cursor.execute(
                    """
                    INSERT INTO shares (owner_id, kind, folder)
                    VALUES (%s, 'items', NULL)
                    """,
                    (user["id"],),
                )
                share_id = cursor.lastrowid
                cursor.executemany(
                    """
                    INSERT INTO share_items (share_id, media_type, media_id)
                    VALUES (%s, %s, %s)
                    """,
                    [
                        (share_id, media_type, media_id)
                        for media_type, media_id in owned
                    ],
                )
                insert_recipients(cursor, share_id, recipient_ids)

            share = load_share_row(cursor, share_id)
            payload = hydrate_share(cursor, share, user["id"])

        connection.commit()
        return jsonify({"status": "ok", "share": payload})
    finally:
        connection.close()


@community_bp.get("/bp/community/shares/<int:share_id>/media")
def list_share_media(share_id):
    offset = parse_non_negative_int(request.args.get("offset"), 0)
    limit = parse_non_negative_int(request.args.get("limit"), 200)
    limit = min(max(limit, 1), MAX_FOLDER_PAGE_SIZE)

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            share = load_share_row(cursor, share_id)
            if not share or not viewer_can_see_share(
                cursor, share_id, user["id"], share["owner_id"]
            ):
                return (
                    jsonify({"status": "error", "message": "Nicht gefunden."}),
                    404,
                )

            owner_id = share["owner_id"]
            if share["kind"] == "folder":
                rows, has_more = fetch_folder_page(
                    cursor, owner_id, share["folder"], offset, limit
                )
                total = count_folder_items(cursor, owner_id, share["folder"])
            else:
                rows, has_more = fetch_share_items_page(
                    cursor, share_id, owner_id, offset, limit
                )
                total = count_share_items(cursor, share_id)

            items = serialize_and_prime(rows, owner_id)

        return jsonify(
            {
                "status": "ok",
                "share_id": share_id,
                "offset": offset,
                "limit": limit,
                "total": total,
                "has_more": has_more,
                "items": items,
            }
        )
    finally:
        connection.close()


@community_bp.delete("/bp/community/shares/<int:share_id>")
def delete_share(share_id):
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM shares WHERE id = %s AND owner_id = %s",
                (share_id, user["id"]),
            )
            share = cursor.fetchone()
            if not share:
                return (
                    jsonify({"status": "error", "message": "Nicht gefunden."}),
                    404,
                )
            cursor.execute("DELETE FROM shares WHERE id = %s", (share_id,))

        connection.commit()
        return jsonify({"status": "ok"})
    finally:
        connection.close()
