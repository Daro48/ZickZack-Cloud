import os
import threading
from calendar import monthrange
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from flask import Blueprint, Response, jsonify, request, send_file
from database import get_database_connection
from upload import (
    MEDIA_ROOT,
    create_media_thumbnail,
    require_user,
    sanitize_folder_name,
    thumb_relative_path,
)

media_bp = Blueprint("media", __name__)

MEDIA_CACHE_SECONDS = 31536000
MAX_FOLDER_PAGE_SIZE = 500
MEDIA_META_CACHE_MAX = int(os.getenv("MEDIA_META_CACHE_MAX", "50000"))
ON_DEMAND_THUMB_WORKERS = int(os.getenv("ON_DEMAND_THUMB_WORKERS", "3"))
ON_DEMAND_THUMB_WAIT_SECONDS = float(os.getenv("ON_DEMAND_THUMB_WAIT", "5"))
THUMB_CACHE_BUDGET_BYTES = int(os.getenv("THUMB_CACHE_MB", "192")) * 1024 * 1024
THUMB_CACHE_MAX_FILE_BYTES = int(os.getenv("THUMB_CACHE_MAX_FILE_BYTES", "2097152"))

MEDIA_ROOT_RESOLVED = MEDIA_ROOT.resolve()

# Beide Caches laufen ohne Ablaufzeit, weil Media-Zeilen und fertige Thumbnails
# nach dem Upload nicht mehr verändert werden. Ein Löschen-Endpunkt müsste die
# betroffenen Einträge hier entfernen.
_media_meta_cache = OrderedDict()
_media_meta_lock = threading.Lock()

_thumb_cache = OrderedDict()
_thumb_cache_bytes = 0
_thumb_cache_lock = threading.Lock()

_thumb_slots = threading.BoundedSemaphore(max(1, ON_DEMAND_THUMB_WORKERS))


def cache_media_meta(user_id, media_type, media_id, meta):
    key = (user_id, media_type, media_id)
    with _media_meta_lock:
        _media_meta_cache[key] = meta
        _media_meta_cache.move_to_end(key)
        while len(_media_meta_cache) > MEDIA_META_CACHE_MAX:
            _media_meta_cache.popitem(last=False)


def load_media_meta(connection, user_id, media_type, media_id):
    key = (user_id, media_type, media_id)
    with _media_meta_lock:
        meta = _media_meta_cache.get(key)
        if meta is not None:
            _media_meta_cache.move_to_end(key)
            return meta

    table = "photos" if media_type == "photo" else "videos"
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT stored_path, mime_type, original_name
            FROM {table}
            WHERE id = %s AND user_id = %s
            """,
            (media_id, user_id),
        )
        row = cursor.fetchone()

    if not row:
        return None

    cache_media_meta(user_id, media_type, media_id, row)
    return row


def load_accessible_media_meta(connection, viewer_id, media_type, media_id):
    """Liefert Metadaten, wenn der User Besitzer ist oder die Datei geteilt bekam."""
    meta = load_media_meta(connection, viewer_id, media_type, media_id)
    if meta is not None:
        return meta

    table = "photos" if media_type == "photo" else "videos"
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT user_id, stored_path, mime_type, original_name, folder
            FROM {table}
            WHERE id = %s
            """,
            (media_id,),
        )
        row = cursor.fetchone()

    if not row:
        return None

    from community import user_can_access_shared_media

    if not user_can_access_shared_media(
        connection,
        viewer_id,
        row["user_id"],
        media_type,
        media_id,
        row["folder"],
    ):
        return None

    owner_meta = {
        "stored_path": row["stored_path"],
        "mime_type": row["mime_type"],
        "original_name": row["original_name"],
    }
    cache_media_meta(row["user_id"], media_type, media_id, owner_meta)
    return {**owner_meta, "owner_id": row["user_id"]}


def media_path(relative_path):
    """Pfad unterhalb von MEDIA_ROOT, oder None wenn er ausserhalb liegt.

    Die Prüfung ist bewusst rein lexikalisch statt über resolve(): Symlinks legt
    die Anwendung im Medienverzeichnis nicht an, und resolve() kostet pro
    Anfrage mehrere Dateisystem-Zugriffe.
    """
    candidate = Path(os.path.normpath(MEDIA_ROOT_RESOLVED / relative_path))
    try:
        candidate.relative_to(MEDIA_ROOT_RESOLVED)
    except ValueError:
        return None
    return candidate


def apply_media_cache_headers(response):
    response.cache_control.public = False
    response.cache_control.private = True
    response.cache_control.max_age = MEDIA_CACHE_SECONDS
    return response


def send_media_file(path, mimetype, download_name=None):
    """Streamt die Datei, oder gibt None zurück wenn sie fehlt."""
    try:
        response = send_file(
            path,
            mimetype=mimetype,
            as_attachment=False,
            download_name=download_name,
            conditional=True,
            max_age=MEDIA_CACHE_SECONDS,
        )
    except OSError:
        return None
    return apply_media_cache_headers(response)


def read_thumb_entry(path):
    try:
        stat_result = os.stat(path)
    except OSError:
        return None

    if stat_result.st_size > THUMB_CACHE_MAX_FILE_BYTES:
        return None

    try:
        with open(path, "rb") as handle:
            payload = handle.read()
    except OSError:
        return None

    return {
        "payload": payload,
        "etag": f"{stat_result.st_mtime_ns:x}-{stat_result.st_size:x}",
        "last_modified": datetime.fromtimestamp(stat_result.st_mtime, tz=timezone.utc),
    }


def store_thumb_entry(key, entry):
    global _thumb_cache_bytes

    size = len(entry["payload"])
    with _thumb_cache_lock:
        previous = _thumb_cache.pop(key, None)
        if previous is not None:
            _thumb_cache_bytes -= len(previous["payload"])

        _thumb_cache[key] = entry
        _thumb_cache_bytes += size

        while _thumb_cache_bytes > THUMB_CACHE_BUDGET_BYTES and len(_thumb_cache) > 1:
            _, evicted = _thumb_cache.popitem(last=False)
            _thumb_cache_bytes -= len(evicted["payload"])


def lookup_thumb_entry(key):
    with _thumb_cache_lock:
        entry = _thumb_cache.get(key)
        if entry is not None:
            _thumb_cache.move_to_end(key)
        return entry


def send_thumb_entry(entry):
    response = Response(entry["payload"], mimetype="image/webp")
    response.set_etag(entry["etag"])
    response.last_modified = entry["last_modified"]
    apply_media_cache_headers(response)
    return response.make_conditional(request)


def serialize_item(row):
    created_at = row["created_at"]
    return {
        "id": row["id"],
        "type": row["type"],
        "original_name": row["original_name"],
        "mime_type": row["mime_type"],
        "size_bytes": row["size_bytes"],
        "created_at": created_at.isoformat(sep=" ", timespec="seconds")
        if created_at
        else None,
        "url": f"/bp/media/file/{row['type']}/{row['id']}",
        "thumb_url": f"/bp/media/thumb/{row['type']}/{row['id']}",
    }


def serialize_and_prime(rows, user_id):
    """Füllt den Metadaten-Cache mit, damit die folgenden Bild-Requests der
    Galerie ohne eigene Datenbankabfrage auskommen."""
    items = []
    for row in rows:
        cache_media_meta(
            user_id,
            row["type"],
            row["id"],
            {
                "stored_path": row["stored_path"],
                "mime_type": row["mime_type"],
                "original_name": row["original_name"],
            },
        )
        items.append(serialize_item(row))
    return items


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
                    stored_path,
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
                    stored_path,
                    mime_type,
                    size_bytes,
                    created_at
                FROM videos
                WHERE user_id = %s
                  AND created_at BETWEEN %s AND %s
                ORDER BY created_at DESC, type ASC, id DESC
                """,
                (user["id"], start, end, user["id"], start, end),
            )
            rows = cursor.fetchall()

        return jsonify(
            {
                "status": "ok",
                "year": year,
                "month": month,
                "week": week,
                "start_day": start.day,
                "end_day": end.day,
                "items": serialize_and_prime(rows, user["id"]),
            }
        )
    finally:
        connection.close()


def count_folder_items(cursor, user_id, folder_name):
    cursor.execute(
        """
        SELECT
            (
                SELECT COUNT(*)
                FROM photos
                WHERE user_id = %s AND folder = %s
            ) + (
                SELECT COUNT(*)
                FROM videos
                WHERE user_id = %s AND folder = %s
            ) AS total
        """,
        (user_id, folder_name, user_id, folder_name),
    )
    return int((cursor.fetchone() or {}).get("total") or 0)


def fetch_folder_page(cursor, user_id, folder_name, offset, limit):
    # Ein Element mehr holen als ausgeliefert wird, das ersetzt eine COUNT-Abfrage
    # für has_more.
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
                    id,
                    'photo' AS type,
                    original_name,
                    stored_path,
                    mime_type,
                    size_bytes,
                    created_at
                FROM photos
                WHERE user_id = %s AND folder = %s
                ORDER BY created_at DESC, id DESC
                LIMIT %s
            )
            UNION ALL
            (
                SELECT
                    id,
                    'video' AS type,
                    original_name,
                    stored_path,
                    mime_type,
                    size_bytes,
                    created_at
                FROM videos
                WHERE user_id = %s AND folder = %s
                ORDER BY created_at DESC, id DESC
                LIMIT %s
            )
        ) AS media
        ORDER BY created_at DESC, type ASC, id DESC
        LIMIT %s OFFSET %s
        """,
        (
            user_id,
            folder_name,
            branch_limit,
            user_id,
            folder_name,
            branch_limit,
            probe_limit,
            offset,
        ),
    )
    rows = cursor.fetchall()
    has_more = len(rows) > limit
    return rows[:limit], has_more


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
    limit = parse_positive_int(request.args.get("limit")) or 50
    limit = min(limit, MAX_FOLDER_PAGE_SIZE)

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            rows, has_more = fetch_folder_page(
                cursor, user["id"], folder_name, offset, limit
            )
            total = (
                count_folder_items(cursor, user["id"], folder_name)
                if offset == 0
                else None
            )

        return jsonify(
            {
                "status": "ok",
                "folder": folder_name,
                "offset": offset,
                "limit": limit,
                "total": total,
                "has_more": has_more,
                "items": serialize_and_prime(rows, user["id"]),
            }
        )
    finally:
        connection.close()


@media_bp.get("/bp/media/file/<media_type>/<int:media_id>")
def get_media_file(media_type, media_id):
    if media_type not in ("photo", "video"):
        return jsonify({"status": "error", "message": "Ungültiger Typ."}), 400

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401
        meta = load_accessible_media_meta(connection, user["id"], media_type, media_id)
    finally:
        connection.close()

    if not meta:
        return jsonify({"status": "error", "message": "Nicht gefunden."}), 404

    absolute_path = media_path(meta["stored_path"])
    if absolute_path is None:
        return jsonify({"status": "error", "message": "Ungültiger Pfad."}), 400

    response = send_media_file(
        absolute_path,
        meta["mime_type"],
        download_name=meta["original_name"],
    )
    if response is None:
        return jsonify({"status": "error", "message": "Datei fehlt."}), 404
    return response


def build_thumbnail_on_demand(media_type, original_path, stored_path, thumb_path):
    """Zieht ein fehlendes Thumbnail nach, höchstens ON_DEMAND_THUMB_WORKERS
    gleichzeitig, damit eine frisch geöffnete Galerie den Server nicht mit
    parallelen Dekodierungen blockiert."""
    if not _thumb_slots.acquire(timeout=ON_DEMAND_THUMB_WAIT_SECONDS):
        return None
    try:
        # Wartende Threads prüfen erneut, ein anderer war vielleicht schneller.
        entry = read_thumb_entry(thumb_path)
        if entry is not None:
            return entry
        if not create_media_thumbnail(media_type, original_path, stored_path):
            return None
    finally:
        _thumb_slots.release()

    return read_thumb_entry(thumb_path)


@media_bp.get("/bp/media/thumb/<media_type>/<int:media_id>")
def get_media_thumbnail(media_type, media_id):
    if media_type not in ("photo", "video"):
        return jsonify({"status": "error", "message": "Ungültiger Typ."}), 400

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401
        meta = load_accessible_media_meta(connection, user["id"], media_type, media_id)
    finally:
        connection.close()

    if not meta:
        return jsonify({"status": "error", "message": "Nicht gefunden."}), 404

    stored_path = meta["stored_path"]
    cache_key = (meta.get("owner_id", user["id"]), media_type, media_id)

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
        # Für Fotos ist das Original ein brauchbarer Ersatz. Ein Video als
        # Bildquelle auszuliefern wäre dagegen ein Vielfaches der Datenmenge,
        # dort zeigt das Frontend stattdessen seinen Platzhalter.
        if media_type == "video":
            return jsonify({"status": "error", "message": "Kein Vorschaubild."}), 404

        response = send_media_file(original_path, meta["mime_type"])
        if response is None:
            return jsonify({"status": "error", "message": "Datei fehlt."}), 404
        return response

    store_thumb_entry(cache_key, entry)
    return send_thumb_entry(entry)
