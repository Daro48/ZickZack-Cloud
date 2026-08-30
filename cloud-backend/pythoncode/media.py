from calendar import monthrange
from datetime import datetime
from flask import Blueprint, jsonify, request, send_file
from database import get_database_connection
from upload import (
    MEDIA_ROOT,
    require_user,
    sanitize_folder_name,
    sanitize_username_dir,
)

media_bp = Blueprint("media", __name__)


def week_range(year, month, week):
    last_day = monthrange(year, month)[1]
    start_day = (week - 1) * 7 + 1
    end_day = min(week * 7, last_day)
    if start_day > last_day:
        return None
    start = datetime(year, month, start_day, 0, 0, 0)
    end = datetime(year, month, end_day, 23, 59, 59)
    return start, end


def parse_positive_int(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number < 1:
        return None
    return number


def parse_non_negative_int(value, default=0):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    if number < 0:
        return default
    return number


@media_bp.get("/bp/media")
def list_media_for_week():
    year = parse_positive_int(request.args.get("year"))
    month = parse_positive_int(request.args.get("month"))
    week = parse_positive_int(request.args.get("week"))
    if not year or not month or month > 12 or not week or week > 5:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "year, month und week sind erforderlich.",
                }
            ),
            400,
        )

    bounds = week_range(year, month, week)
    if not bounds:
        return jsonify({"status": "error", "message": "Ungültige Woche."}), 400

    start, end = bounds
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    'photo' AS type,
                    original_name,
                    mime_type,
                    size_bytes,
                    created_at
                FROM photos
                WHERE user_id = %s
                  AND created_at BETWEEN %s AND %s
                UNION ALL
                SELECT
                    id,
                    'video' AS type,
                    original_name,
                    mime_type,
                    size_bytes,
                    created_at
                FROM videos
                WHERE user_id = %s
                  AND created_at BETWEEN %s AND %s
                ORDER BY created_at DESC
                """,
                (user["id"], start, end, user["id"], start, end),
            )
            items = cursor.fetchall()

        media = []
        for item in items:
            created_at = item["created_at"]
            media.append(
                {
                    "id": item["id"],
                    "type": item["type"],
                    "original_name": item["original_name"],
                    "mime_type": item["mime_type"],
                    "size_bytes": item["size_bytes"],
                    "created_at": created_at.isoformat(sep=" ", timespec="seconds"),
                    "url": f"/bp/media/file/{item['type']}/{item['id']}",
                }
            )

        return jsonify(
            {
                "status": "ok",
                "year": year,
                "month": month,
                "week": week,
                "start_day": start.day,
                "end_day": end.day,
                "items": media,
            }
        )
    finally:
        connection.close()


@media_bp.get("/bp/media/folder")
def list_media_for_folder():
    folder_name = sanitize_folder_name(request.args.get("folder"))
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

    offset = parse_non_negative_int(request.args.get("offset"), 0)
    limit = parse_positive_int(request.args.get("limit")) or 5
    limit = min(limit, 50)

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        safe_username = sanitize_username_dir(user["username"])
        if not safe_username:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Benutzerordner ungültig.",
                    }
                ),
                400,
            )

        path_prefix = f"{safe_username}/{folder_name}/"
        params = (user["id"], path_prefix, path_prefix)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    (
                        SELECT COUNT(*)
                        FROM photos
                        WHERE user_id = %s
                          AND LEFT(stored_path, CHAR_LENGTH(%s)) = %s
                    ) + (
                        SELECT COUNT(*)
                        FROM videos
                        WHERE user_id = %s
                          AND LEFT(stored_path, CHAR_LENGTH(%s)) = %s
                    ) AS total
                """,
                params + params,
            )
            total = int((cursor.fetchone() or {}).get("total") or 0)

            cursor.execute(
                """
                SELECT
                    id,
                    type,
                    original_name,
                    mime_type,
                    size_bytes,
                    created_at
                FROM (
                    SELECT
                        id,
                        'photo' AS type,
                        original_name,
                        mime_type,
                        size_bytes,
                        created_at
                    FROM photos
                    WHERE user_id = %s
                      AND LEFT(stored_path, CHAR_LENGTH(%s)) = %s
                    UNION ALL
                    SELECT
                        id,
                        'video' AS type,
                        original_name,
                        mime_type,
                        size_bytes,
                        created_at
                    FROM videos
                    WHERE user_id = %s
                      AND LEFT(stored_path, CHAR_LENGTH(%s)) = %s
                ) AS media
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                params + params + (limit, offset),
            )
            rows = cursor.fetchall()

        items = []
        for item in rows:
            created_at = item["created_at"]
            items.append(
                {
                    "id": item["id"],
                    "type": item["type"],
                    "original_name": item["original_name"],
                    "mime_type": item["mime_type"],
                    "size_bytes": item["size_bytes"],
                    "created_at": created_at.isoformat(sep=" ", timespec="seconds")
                    if created_at
                    else None,
                    "url": f"/bp/media/file/{item['type']}/{item['id']}",
                }
            )

        return jsonify(
            {
                "status": "ok",
                "folder": folder_name,
                "offset": offset,
                "limit": limit,
                "total": total,
                "has_more": offset + len(items) < total,
                "items": items,
            }
        )
    finally:
        connection.close()


@media_bp.get("/bp/media/file/<media_type>/<int:media_id>")
def get_media_file(media_type, media_id):
    if media_type not in ("photo", "video"):
        return jsonify({"status": "error", "message": "Ungültiger Typ."}), 400

    table = "photos" if media_type == "photo" else "videos"
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT stored_path, mime_type, original_name
                FROM {table}
                WHERE id = %s AND user_id = %s
                """,
                (media_id, user["id"]),
            )
            row = cursor.fetchone()

        if not row:
            return jsonify({"status": "error", "message": "Nicht gefunden."}), 404

        absolute_path = (MEDIA_ROOT / row["stored_path"]).resolve()
        media_root = MEDIA_ROOT.resolve()
        try:
            absolute_path.relative_to(media_root)
        except ValueError:
            return jsonify({"status": "error", "message": "Ungültiger Pfad."}), 400
        if not absolute_path.is_file():
            return jsonify({"status": "error", "message": "Datei fehlt."}), 404

        return send_file(
            absolute_path,
            mimetype=row["mime_type"],
            as_attachment=False,
            download_name=row["original_name"],
            conditional=True,
        )
    finally:
        connection.close()