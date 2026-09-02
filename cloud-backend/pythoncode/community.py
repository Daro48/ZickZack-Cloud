import secrets
from datetime import datetime, timedelta, timezone
from flask import Blueprint, jsonify, request
from database import get_database_connection
from media import (
    MAX_FOLDER_PAGE_SIZE,
    build_thumbnail_on_demand,
    count_folder_items,
    fetch_folder_page,
    lookup_thumb_entry,
    media_path,
    parse_non_negative_int,
    read_thumb_entry,
    send_media_file,
    send_thumb_entry,
    serialize_and_prime,
    store_thumb_entry,
)
from upload import list_user_folders, require_user, sanitize_folder_name, thumb_relative_path

community_bp = Blueprint("community", __name__)

PREVIEW_LIMIT = 4
MAX_SHARE_ITEMS = 500
MAX_SHARE_FOLDERS = 50
MAX_NOTE_LENGTH = 280
SHARE_SELECT = """
    shares.id,
    shares.owner_id,
    shares.kind,
    shares.folder,
    shares.note,
    shares.created_at,
    users.username AS owner_username
"""


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
        f"""
        SELECT
            {SHARE_SELECT}
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


def parse_note(value):
    note = str(value or "").strip()
    if not note:
        return None
    if len(note) > MAX_NOTE_LENGTH:
        return note[:MAX_NOTE_LENGTH]
    return note


def parse_public_days(value):
    try:
        days = int(value)
    except (TypeError, ValueError):
        return None
    if days in {1, 7, 30}:
        return days
    return None


def public_url_for(token):
    return f"/s/{token}"


def load_active_link(cursor, share_id):
    cursor.execute(
        """
        SELECT token, expires_at
        FROM share_links
        WHERE share_id = %s AND expires_at > UTC_TIMESTAMP()
        ORDER BY expires_at DESC
        LIMIT 1
        """,
        (share_id,),
    )
    return cursor.fetchone()


def insert_share_link(cursor, share_id, days):
    token = secrets.token_hex(16)
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=days)
    cursor.execute(
        """
        INSERT INTO share_links (share_id, token, expires_at)
        VALUES (%s, %s, %s)
        """,
        (share_id, token, expires_at),
    )
    return {"token": token, "expires_at": expires_at, "url": public_url_for(token)}


def serialize_link(row):
    if not row:
        return None
    expires_at = row["expires_at"]
    return {
        "token": row["token"],
        "url": public_url_for(row["token"]),
        "expires_at": format_created_at(expires_at),
    }


def notify_recipients(cursor, share, recipient_ids):
    if not recipient_ids:
        return
    owner_name = share["owner_username"]
    if share["kind"] == "folder" and share["folder"]:
        message = f"{owner_name} hat den Ordner „{share['folder']}“ mit dir geteilt."
    else:
        message = f"{owner_name} hat Dateien mit dir geteilt."
    if len(message) > 255:
        message = message[:255]
    cursor.executemany(
        """
        INSERT INTO notifications (user_id, share_id, message)
        VALUES (%s, %s, %s)
        """,
        [(user_id, share["id"], message) for user_id in recipient_ids],
    )


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

    payload = {
        "id": share["id"],
        "kind": share["kind"],
        "folder": share["folder"],
        "note": share.get("note"),
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
        "public_link": None,
    }
    if owner_id == viewer_id:
        payload["public_link"] = serialize_link(load_active_link(cursor, share["id"]))
    return payload


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
                f"""
                SELECT
                    {SHARE_SELECT}
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
                f"""
                SELECT
                    {SHARE_SELECT}
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
        if kind not in {"folder", "folders", "items"}:
            return (
                jsonify({"status": "error", "message": "Ungültige Freigabe."}),
                400,
            )

        note = parse_note(data.get("note"))
        public_days = parse_public_days(data.get("public_days"))

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

            created_ids = []
            if kind in {"folder", "folders"}:
                folder_names = []
                raw_folders = data.get("folders") if kind == "folders" else None
                if raw_folders:
                    for raw_name in raw_folders:
                        folder_name = sanitize_folder_name(raw_name)
                        if folder_name and folder_name not in folder_names:
                            folder_names.append(folder_name)
                else:
                    folder_name = sanitize_folder_name(data.get("folder"))
                    if folder_name:
                        folder_names.append(folder_name)

                if not folder_names:
                    return (
                        jsonify(
                            {
                                "status": "error",
                                "message": "Bitte einen Ordner wählen.",
                            }
                        ),
                        400,
                    )
                if len(folder_names) > MAX_SHARE_FOLDERS:
                    return (
                        jsonify(
                            {
                                "status": "error",
                                "message": "Zu viele Ordner auf einmal.",
                            }
                        ),
                        400,
                    )

                existing_folders = set(list_user_folders(user["username"]))
                for folder_name in folder_names:
                    if folder_name not in existing_folders:
                        return (
                            jsonify(
                                {
                                    "status": "error",
                                    "message": f'Der Ordner „{folder_name}“ existiert nicht.',
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
                    already = set()
                    if existing:
                        share_id = existing["id"]
                        already = {
                            row["id"] for row in load_recipients(cursor, share_id)
                        }
                        if note is not None:
                            cursor.execute(
                                "UPDATE shares SET note = %s WHERE id = %s",
                                (note, share_id),
                            )
                    else:
                        cursor.execute(
                            """
                            INSERT INTO shares (owner_id, kind, folder, note)
                            VALUES (%s, 'folder', %s, %s)
                            """,
                            (user["id"], folder_name, note),
                        )
                        share_id = cursor.lastrowid
                    insert_recipients(cursor, share_id, recipient_ids)
                    created_ids.append(
                        (
                            share_id,
                            [user_id for user_id in recipient_ids if user_id not in already],
                        )
                    )
            else:
                owned, error_message = parse_owned_items(
                    cursor, user["id"], data.get("items")
                )
                if error_message:
                    return jsonify({"status": "error", "message": error_message}), 400

                cursor.execute(
                    """
                    INSERT INTO shares (owner_id, kind, folder, note)
                    VALUES (%s, 'items', NULL, %s)
                    """,
                    (user["id"], note),
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
                created_ids.append((share_id, recipient_ids))

            payloads = []
            for share_id, notified_ids in created_ids:
                share = load_share_row(cursor, share_id)
                if public_days:
                    insert_share_link(cursor, share_id, public_days)
                notify_recipients(cursor, share, notified_ids)
                payloads.append(hydrate_share(cursor, share, user["id"]))

        connection.commit()
        return jsonify(
            {
                "status": "ok",
                "share": payloads[0],
                "shares": payloads,
            }
        )
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


@community_bp.delete("/bp/community/shares/<int:share_id>/leave")
def leave_share(share_id):
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM share_recipients
                WHERE share_id = %s AND user_id = %s
                """,
                (share_id, user["id"]),
            )
            if cursor.rowcount < 1:
                return jsonify({"status": "error", "message": "Nicht gefunden."}), 404

        connection.commit()
        return jsonify({"status": "ok"})
    finally:
        connection.close()


@community_bp.post("/bp/community/shares/<int:share_id>/link")
def create_share_link(share_id):
    data = request.get_json(silent=True) or {}
    days = parse_public_days(data.get("days") or data.get("public_days")) or 7

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
            if not cursor.fetchone():
                return jsonify({"status": "error", "message": "Nicht gefunden."}), 404
            link = insert_share_link(cursor, share_id, days)

        connection.commit()
        return jsonify(
            {
                "status": "ok",
                "public_link": {
                    "token": link["token"],
                    "url": link["url"],
                    "expires_at": format_created_at(link["expires_at"]),
                    "days": days,
                },
            }
        )
    finally:
        connection.close()


@community_bp.get("/bp/community/notifications")
def list_notifications():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, share_id, message, read_at, created_at
                FROM notifications
                WHERE user_id = %s
                ORDER BY created_at DESC, id DESC
                LIMIT 50
                """,
                (user["id"],),
            )
            rows = cursor.fetchall()
            cursor.execute(
                """
                SELECT COUNT(*) AS unread
                FROM notifications
                WHERE user_id = %s AND read_at IS NULL
                """,
                (user["id"],),
            )
            unread = int((cursor.fetchone() or {}).get("unread") or 0)

        return jsonify(
            {
                "status": "ok",
                "unread": unread,
                "notifications": [
                    {
                        "id": row["id"],
                        "share_id": row["share_id"],
                        "message": row["message"],
                        "read": row["read_at"] is not None,
                        "created_at": format_created_at(row["created_at"]),
                    }
                    for row in rows
                ],
            }
        )
    finally:
        connection.close()


@community_bp.post("/bp/community/notifications/read")
def mark_notifications_read():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE notifications
                SET read_at = UTC_TIMESTAMP()
                WHERE user_id = %s AND read_at IS NULL
                """,
                (user["id"],),
            )

        connection.commit()
        return jsonify({"status": "ok"})
    finally:
        connection.close()


def sanitize_public_token(value):
    token = str(value or "").strip().lower()
    if len(token) != 32:
        return None
    if any(char not in "0123456789abcdef" for char in token):
        return None
    return token


def load_public_share(cursor, token):
    cursor.execute(
        f"""
        SELECT
            {SHARE_SELECT},
            share_links.token,
            share_links.expires_at AS link_expires_at
        FROM share_links
        INNER JOIN shares ON shares.id = share_links.share_id
        INNER JOIN users ON users.id = shares.owner_id
        WHERE share_links.token = %s
          AND share_links.expires_at > UTC_TIMESTAMP()
        """,
        (token,),
    )
    return cursor.fetchone()


def media_belongs_to_share(cursor, share, media_type, media_id):
    table = "photos" if media_type == "photo" else "videos"
    cursor.execute(
        f"""
        SELECT id, folder, stored_path, mime_type, original_name
        FROM {table}
        WHERE id = %s AND user_id = %s
        """,
        (media_id, share["owner_id"]),
    )
    row = cursor.fetchone()
    if not row:
        return None
    if share["kind"] == "folder":
        if row["folder"] != share["folder"]:
            return None
        return row
    cursor.execute(
        """
        SELECT 1
        FROM share_items
        WHERE share_id = %s AND media_type = %s AND media_id = %s
        """,
        (share["id"], media_type, media_id),
    )
    if not cursor.fetchone():
        return None
    return row


def public_url_prefix(token):
    return f"/bp/public/{token}"


@community_bp.get("/bp/public/<token>")
def get_public_share(token):
    token = sanitize_public_token(token)
    if not token:
        return jsonify({"status": "error", "message": "Ungültiger Link."}), 404

    connection = get_database_connection()
    try:
        with connection.cursor() as cursor:
            share = load_public_share(cursor, token)
            if not share:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "Dieser Link ist ungültig oder abgelaufen.",
                        }
                    ),
                    404,
                )
            payload = hydrate_share(cursor, share, share["owner_id"])
            payload["mine"] = False
            payload["public_link"] = {
                "token": token,
                "url": public_url_for(token),
                "expires_at": format_created_at(share.get("link_expires_at")),
            }
        return jsonify({"status": "ok", "share": payload})
    finally:
        connection.close()


@community_bp.get("/bp/public/<token>/media")
def list_public_share_media(token):
    token = sanitize_public_token(token)
    if not token:
        return jsonify({"status": "error", "message": "Ungültiger Link."}), 404

    offset = parse_non_negative_int(request.args.get("offset"), 0)
    limit = parse_non_negative_int(request.args.get("limit"), 200)
    limit = min(max(limit, 1), MAX_FOLDER_PAGE_SIZE)

    connection = get_database_connection()
    try:
        with connection.cursor() as cursor:
            share = load_public_share(cursor, token)
            if not share:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "Dieser Link ist ungültig oder abgelaufen.",
                        }
                    ),
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
                    cursor, share["id"], owner_id, offset, limit
                )
                total = count_share_items(cursor, share["id"])

            items = serialize_and_prime(
                rows, owner_id, url_prefix=public_url_prefix(token)
            )

        return jsonify(
            {
                "status": "ok",
                "share_id": share["id"],
                "offset": offset,
                "limit": limit,
                "total": total,
                "has_more": has_more,
                "items": items,
            }
        )
    finally:
        connection.close()


def send_public_media(token, media_type, media_id, as_thumb=False):
    token = sanitize_public_token(token)
    if not token or media_type not in ("photo", "video"):
        return jsonify({"status": "error", "message": "Nicht gefunden."}), 404

    connection = get_database_connection()
    try:
        with connection.cursor() as cursor:
            share = load_public_share(cursor, token)
            if not share:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "Dieser Link ist ungültig oder abgelaufen.",
                        }
                    ),
                    404,
                )
            meta = media_belongs_to_share(cursor, share, media_type, media_id)
    finally:
        connection.close()

    if not meta:
        return jsonify({"status": "error", "message": "Nicht gefunden."}), 404

    stored_path = meta["stored_path"]
    if as_thumb:
        cache_key = (share["owner_id"], media_type, media_id)
        entry = lookup_thumb_entry(cache_key)
        if entry is not None:
            return send_thumb_entry(entry)

        thumb_path = media_path(thumb_relative_path(stored_path))
        original_path = media_path(stored_path)
        if thumb_path is None or original_path is None:
            return jsonify({"status": "error", "message": "Ungültiger Pfad."}), 400

        entry = read_thumb_entry(thumb_path)
        if entry is None:
            entry = build_thumbnail_on_demand(
                media_type, original_path, stored_path, thumb_path
            )
        if entry is None:
            if media_type == "video":
                return jsonify({"status": "error", "message": "Kein Vorschaubild."}), 404
            response = send_media_file(original_path, meta["mime_type"])
            if response is None:
                return jsonify({"status": "error", "message": "Datei fehlt."}), 404
            return response
        store_thumb_entry(cache_key, entry)
        return send_thumb_entry(entry)

    absolute_path = media_path(stored_path)
    if absolute_path is None:
        return jsonify({"status": "error", "message": "Ungültiger Pfad."}), 400
    response = send_media_file(
        absolute_path,
        meta["mime_type"],
        download_name=meta["original_name"],
        as_attachment=request.args.get("download") == "1",
    )
    if response is None:
        return jsonify({"status": "error", "message": "Datei fehlt."}), 404
    return response


@community_bp.get("/bp/public/<token>/file/<media_type>/<int:media_id>")
def get_public_media_file(token, media_type, media_id):
    return send_public_media(token, media_type, media_id, as_thumb=False)


@community_bp.get("/bp/public/<token>/thumb/<media_type>/<int:media_id>")
def get_public_media_thumb(token, media_type, media_id):
    return send_public_media(token, media_type, media_id, as_thumb=True)
