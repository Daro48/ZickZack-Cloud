import os
import shutil
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
    list_user_folders,
    require_user,
    sanitize_folder_name,
    thumb_relative_path,
    user_media_root,
)

media_bp = Blueprint("media", __name__)

MEDIA_CACHE_SECONDS = 31536000
MAX_FOLDER_PAGE_SIZE = 500
MAX_DELETE_ITEMS = 500
STORAGE_QUOTA_BYTES = int(os.getenv("STORAGE_QUOTA_BYTES", str(225 * 1024 * 1024 * 1024)))
FOLDER_SORTS = {
    "newest": ("created_at DESC, type ASC, id DESC", "created_at DESC, id DESC"),
    "oldest": ("created_at ASC, type ASC, id ASC", "created_at ASC, id ASC"),
    "name": ("original_name ASC, created_at DESC, id DESC", "original_name ASC, id DESC"),
}
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


def drop_media_meta(user_id, media_type, media_id):
    key = (user_id, media_type, media_id)
    with _media_meta_lock:
        _media_meta_cache.pop(key, None)


def drop_thumb_cache(user_id, media_type, media_id):
    global _thumb_cache_bytes
    key = (user_id, media_type, media_id)
    with _thumb_cache_lock:
        entry = _thumb_cache.pop(key, None)
        if entry is not None:
            _thumb_cache_bytes -= len(entry["payload"])


def drop_media_caches(user_id, media_type, media_id):
    drop_media_meta(user_id, media_type, media_id)
    drop_thumb_cache(user_id, media_type, media_id)


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


def send_media_file(path, mimetype, download_name=None, as_attachment=False):
    """Streamt die Datei, oder gibt None zurück wenn sie fehlt."""
    try:
        response = send_file(
            path,
            mimetype=mimetype,
            as_attachment=as_attachment,
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


def serialize_item(row, url_prefix=None):
    created_at = row["created_at"]
    media_type = row["type"]
    media_id = row["id"]
    if url_prefix:
        file_url = f"{url_prefix}/file/{media_type}/{media_id}"
        thumb_url = f"{url_prefix}/thumb/{media_type}/{media_id}"
    else:
        file_url = f"/bp/media/file/{media_type}/{media_id}"
        thumb_url = f"/bp/media/thumb/{media_type}/{media_id}"
    return {
        "id": media_id,
        "type": media_type,
        "original_name": row["original_name"],
        "mime_type": row["mime_type"],
        "size_bytes": row["size_bytes"],
        "created_at": created_at.isoformat(sep=" ", timespec="seconds")
        if created_at
        else None,
        "url": file_url,
        "thumb_url": thumb_url,
        "download_url": f"{file_url}?download=1",
    }


def serialize_and_prime(rows, user_id, url_prefix=None):
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
        items.append(serialize_item(row, url_prefix=url_prefix))
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


def parse_media_type_filter(value):
    if value in ("photo", "video"):
        return value
    return None


def parse_folder_sort(value):
    if value in FOLDER_SORTS:
        return value
    return "newest"


def name_search_clause(raw_query):
    query = str(raw_query or "").strip()
    if not query:
        return "", []
    escaped = (
        query.replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )
    return " AND original_name LIKE %s ESCAPE '\\\\'", [f"%{escaped}%"]


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


def count_folder_items(cursor, user_id, folder_name, media_type=None, query=None):
    extra_sql, extra_params = name_search_clause(query)
    tables = []
    if media_type != "video":
        tables.append("photos")
    if media_type != "photo":
        tables.append("videos")

    total = 0
    for table in tables:
        cursor.execute(
            f"""
            SELECT COUNT(*) AS total
            FROM {table}
            WHERE user_id = %s AND folder = %s{extra_sql}
            """,
            (user_id, folder_name, *extra_params),
        )
        total += int((cursor.fetchone() or {}).get("total") or 0)
    return total


def fetch_folder_page(
    cursor,
    user_id,
    folder_name,
    offset,
    limit,
    media_type=None,
    query=None,
    sort="newest",
):
    # Ein Element mehr holen als ausgeliefert wird, das ersetzt eine COUNT-Abfrage
    # für has_more.
    probe_limit = limit + 1
    branch_limit = offset + probe_limit
    extra_sql, extra_params = name_search_clause(query)
    outer_order, branch_order = FOLDER_SORTS.get(sort, FOLDER_SORTS["newest"])

    branches = []
    params = []
    wanted = []
    if media_type != "video":
        wanted.append(("photos", "photo"))
    if media_type != "photo":
        wanted.append(("videos", "video"))

    for table, type_label in wanted:
        branches.append(
            f"""
            (
                SELECT
                    id,
                    '{type_label}' AS type,
                    original_name,
                    stored_path,
                    mime_type,
                    size_bytes,
                    created_at
                FROM {table}
                WHERE user_id = %s AND folder = %s{extra_sql}
                ORDER BY {branch_order}
                LIMIT %s
            )
            """
        )
        params.extend((user_id, folder_name, *extra_params, branch_limit))

    cursor.execute(
        f"""
        SELECT
            id,
            type,
            original_name,
            stored_path,
            mime_type,
            size_bytes,
            created_at
        FROM (
            {" UNION ALL ".join(branches)}
        ) AS media
        ORDER BY {outer_order}
        LIMIT %s OFFSET %s
        """,
        (*params, probe_limit, offset),
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
    media_type = parse_media_type_filter(request.args.get("type"))
    query = request.args.get("q") or request.args.get("query")
    sort = parse_folder_sort(request.args.get("sort"))

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            rows, has_more = fetch_folder_page(
                cursor,
                user["id"],
                folder_name,
                offset,
                limit,
                media_type=media_type,
                query=query,
                sort=sort,
            )
            total = (
                count_folder_items(
                    cursor,
                    user["id"],
                    folder_name,
                    media_type=media_type,
                    query=query,
                )
                if offset == 0
                else None
            )

        return jsonify(
            {
                "status": "ok",
                "folder": folder_name,
                "offset": offset,
                "limit": limit,
                "type": media_type or "all",
                "query": str(query or "").strip(),
                "sort": sort,
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
        as_attachment=request.args.get("download") == "1",
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


def unlink_media_files(stored_path):
    absolute_path = media_path(stored_path)
    if absolute_path is not None:
        absolute_path.unlink(missing_ok=True)
    thumb_path = media_path(thumb_relative_path(stored_path))
    if thumb_path is not None:
        thumb_path.unlink(missing_ok=True)


def used_storage_bytes(cursor, user_id):
    cursor.execute(
        """
        SELECT
            (
                SELECT COALESCE(SUM(size_bytes), 0)
                FROM photos
                WHERE user_id = %s
            ) + (
                SELECT COALESCE(SUM(size_bytes), 0)
                FROM videos
                WHERE user_id = %s
            ) AS used
        """,
        (user_id, user_id),
    )
    return int((cursor.fetchone() or {}).get("used") or 0)


def collect_owned_media(cursor, user_id, raw_items):
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

    owned = []
    if wanted_photos:
        placeholders = ", ".join(["%s"] * len(wanted_photos))
        cursor.execute(
            f"""
            SELECT id, stored_path, folder
            FROM photos
            WHERE user_id = %s AND id IN ({placeholders})
            """,
            (user_id, *wanted_photos),
        )
        found = cursor.fetchall()
        if {row["id"] for row in found} != wanted_photos:
            return None
        owned.extend(
            ("photo", row["id"], row["stored_path"], row["folder"]) for row in found
        )
    if wanted_videos:
        placeholders = ", ".join(["%s"] * len(wanted_videos))
        cursor.execute(
            f"""
            SELECT id, stored_path, folder
            FROM videos
            WHERE user_id = %s AND id IN ({placeholders})
            """,
            (user_id, *wanted_videos),
        )
        found = cursor.fetchall()
        if {row["id"] for row in found} != wanted_videos:
            return None
        owned.extend(
            ("video", row["id"], row["stored_path"], row["folder"]) for row in found
        )
    return owned


def delete_owned_media(cursor, user_id, owned):
    paths = []
    for media_type, media_id, stored_path, *_ in owned:
        table = "photos" if media_type == "photo" else "videos"
        cursor.execute(
            f"DELETE FROM {table} WHERE id = %s AND user_id = %s",
            (media_id, user_id),
        )
        cursor.execute(
            """
            DELETE FROM share_items
            WHERE media_type = %s AND media_id = %s
            """,
            (media_type, media_id),
        )
        drop_media_caches(user_id, media_type, media_id)
        paths.append(stored_path)
    return paths


def rewrite_stored_path(stored_path, old_folder, new_folder):
    parts = str(stored_path).replace("\\", "/").split("/")
    if len(parts) >= 2 and parts[1] == old_folder:
        parts[1] = new_folder
        return "/".join(parts)
    return stored_path


def relocate_media_file(old_stored, new_stored):
    """Verschiebt Datei und Thumbnail. Gibt Undo-Daten zurück oder None."""
    old_abs = media_path(old_stored)
    new_abs = media_path(new_stored)
    if old_abs is None or new_abs is None or not old_abs.is_file():
        return None
    if new_abs.exists():
        return None

    new_abs.parent.mkdir(parents=True, exist_ok=True)
    old_abs.replace(new_abs)

    old_thumb = media_path(thumb_relative_path(old_stored).as_posix())
    new_thumb = media_path(thumb_relative_path(new_stored).as_posix())
    thumb_moved = False
    if (
        old_thumb is not None
        and new_thumb is not None
        and old_thumb.is_file()
        and not new_thumb.exists()
    ):
        new_thumb.parent.mkdir(parents=True, exist_ok=True)
        old_thumb.replace(new_thumb)
        thumb_moved = True

    return (new_abs, old_abs, new_thumb, old_thumb, thumb_moved)


def undo_relocate_media_file(step):
    new_abs, old_abs, new_thumb, old_thumb, thumb_moved = step
    old_abs.parent.mkdir(parents=True, exist_ok=True)
    if new_abs.is_file() and not old_abs.exists():
        new_abs.replace(old_abs)
    if thumb_moved and new_thumb is not None and old_thumb is not None:
        old_thumb.parent.mkdir(parents=True, exist_ok=True)
        if new_thumb.is_file() and not old_thumb.exists():
            new_thumb.replace(old_thumb)


@media_bp.get("/bp/media/storage")
def get_storage():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            used = used_storage_bytes(cursor, user["id"])

        quota = STORAGE_QUOTA_BYTES
        return jsonify(
            {
                "status": "ok",
                "used_bytes": used,
                "quota_bytes": quota,
                "free_bytes": max(0, quota - used) if quota > 0 else None,
            }
        )
    finally:
        connection.close()


@media_bp.delete("/bp/media/file/<media_type>/<int:media_id>")
def delete_media_file(media_type, media_id):
    if media_type not in ("photo", "video"):
        return jsonify({"status": "error", "message": "Ungültiger Typ."}), 400

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            owned = collect_owned_media(
                cursor, user["id"], [{"type": media_type, "id": media_id}]
            )
            if not owned:
                return jsonify({"status": "error", "message": "Nicht gefunden."}), 404
            paths = delete_owned_media(cursor, user["id"], owned)

        connection.commit()
        for stored_path in paths:
            unlink_media_files(stored_path)
        return jsonify({"status": "ok", "deleted": 1})
    finally:
        connection.close()


@media_bp.post("/bp/media/delete")
def delete_media_items():
    data = request.get_json(silent=True) or {}
    raw_items = data.get("items") or []
    if not raw_items:
        return jsonify({"status": "error", "message": "Keine Dateien gewählt."}), 400
    if len(raw_items) > MAX_DELETE_ITEMS:
        return (
            jsonify({"status": "error", "message": "Zu viele Dateien auf einmal."}),
            400,
        )

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        with connection.cursor() as cursor:
            owned = collect_owned_media(cursor, user["id"], raw_items)
            if owned is None:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "Mindestens eine Datei gehört dir nicht.",
                        }
                    ),
                    400,
                )
            if not owned:
                return (
                    jsonify({"status": "error", "message": "Keine Dateien gewählt."}),
                    400,
                )
            paths = delete_owned_media(cursor, user["id"], owned)

        connection.commit()
        for stored_path in paths:
            unlink_media_files(stored_path)
        return jsonify({"status": "ok", "deleted": len(owned)})
    finally:
        connection.close()


@media_bp.post("/bp/media/move")
def move_media_items():
    data = request.get_json(silent=True) or {}
    dest_folder = sanitize_folder_name(data.get("folder") or data.get("destination"))
    raw_items = data.get("items") or []
    if not dest_folder:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Bitte einen Zielordner wählen.",
                }
            ),
            400,
        )
    if not raw_items:
        return jsonify({"status": "error", "message": "Keine Dateien gewählt."}), 400
    if len(raw_items) > MAX_DELETE_ITEMS:
        return (
            jsonify({"status": "error", "message": "Zu viele Dateien auf einmal."}),
            400,
        )

    connection = get_database_connection()
    moved_files = []
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        existing_folders = set(list_user_folders(user["username"]))
        if dest_folder not in existing_folders:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": f'Der Ordner "{dest_folder}" existiert nicht.',
                    }
                ),
                400,
            )

        with connection.cursor() as cursor:
            owned = collect_owned_media(cursor, user["id"], raw_items)
            if owned is None:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "Mindestens eine Datei gehört dir nicht.",
                        }
                    ),
                    400,
                )
            if not owned:
                return (
                    jsonify({"status": "error", "message": "Keine Dateien gewählt."}),
                    400,
                )

            planned = []
            for media_type, media_id, stored_path, folder in owned:
                if folder == dest_folder:
                    continue
                next_path = rewrite_stored_path(stored_path, folder, dest_folder)
                if next_path == stored_path:
                    return (
                        jsonify(
                            {
                                "status": "error",
                                "message": "Mindestens eine Datei konnte nicht verschoben werden.",
                            }
                        ),
                        400,
                    )
                planned.append(
                    (media_type, media_id, stored_path, next_path)
                )

            if not planned:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "Die Dateien liegen schon in diesem Ordner.",
                        }
                    ),
                    400,
                )

            for media_type, media_id, stored_path, next_path in planned:
                step = relocate_media_file(stored_path, next_path)
                if step is None:
                    for done in reversed(moved_files):
                        undo_relocate_media_file(done)
                    return (
                        jsonify(
                            {
                                "status": "error",
                                "message": "Dateien konnten nicht verschoben werden.",
                            }
                        ),
                        500,
                    )
                moved_files.append(step)

            for media_type, media_id, stored_path, next_path in planned:
                table = "photos" if media_type == "photo" else "videos"
                cursor.execute(
                    f"""
                    UPDATE {table}
                    SET folder = %s, stored_path = %s
                    WHERE id = %s AND user_id = %s
                    """,
                    (dest_folder, next_path, media_id, user["id"]),
                )
                drop_media_caches(user["id"], media_type, media_id)

        connection.commit()
        return jsonify(
            {
                "status": "ok",
                "moved": len(planned),
                "folder": dest_folder,
            }
        )
    except Exception:
        for done in reversed(moved_files):
            undo_relocate_media_file(done)
        raise
    finally:
        connection.close()


@media_bp.patch("/bp/media/folders")
def rename_folder():
    data = request.get_json(silent=True) or {}
    old_name = sanitize_folder_name(data.get("folder") or data.get("old_folder"))
    new_name = sanitize_folder_name(data.get("new_folder") or data.get("name"))
    if not old_name or not new_name:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Ungültiger Ordnername. Erlaubt: Buchstaben, Zahlen, Leerzeichen, - und _.",
                }
            ),
            400,
        )
    if old_name == new_name:
        return jsonify({"status": "ok", "folder": new_name})

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        root = user_media_root(user["username"])
        if root is None:
            return jsonify({"status": "error", "message": "Nicht gefunden."}), 404

        old_path = root / old_name
        new_path = root / new_name
        if not old_path.is_dir():
            return jsonify({"status": "error", "message": "Ordner nicht gefunden."}), 404
        if new_path.exists():
            return (
                jsonify({"status": "error", "message": "Dieser Ordner existiert schon."}),
                409,
            )

        with connection.cursor() as cursor:
            for table in ("photos", "videos"):
                cursor.execute(
                    f"""
                    SELECT id, stored_path
                    FROM {table}
                    WHERE user_id = %s AND folder = %s
                    """,
                    (user["id"], old_name),
                )
                rows = cursor.fetchall()
                media_type = "photo" if table == "photos" else "video"
                for row in rows:
                    next_path = rewrite_stored_path(
                        row["stored_path"], old_name, new_name
                    )
                    cursor.execute(
                        f"""
                        UPDATE {table}
                        SET folder = %s, stored_path = %s
                        WHERE id = %s AND user_id = %s
                        """,
                        (new_name, next_path, row["id"], user["id"]),
                    )
                    drop_media_caches(user["id"], media_type, row["id"])

            cursor.execute(
                """
                UPDATE shares
                SET folder = %s
                WHERE owner_id = %s AND kind = 'folder' AND folder = %s
                """,
                (new_name, user["id"], old_name),
            )

        try:
            old_path.rename(new_path)
        except OSError:
            connection.rollback()
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Ordner konnte nicht umbenannt werden.",
                    }
                ),
                500,
            )

        connection.commit()
        return jsonify(
            {
                "status": "ok",
                "folder": new_name,
                "folders": list_user_folders(user["username"]),
            }
        )
    finally:
        connection.close()


@media_bp.delete("/bp/media/folders")
def delete_folder():
    folder_name = sanitize_folder_name(
        request.args.get("folder") or (request.get_json(silent=True) or {}).get("folder")
    )
    if not folder_name:
        return jsonify({"status": "error", "message": "Bitte einen Ordner wählen."}), 400

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        root = user_media_root(user["username"])
        folder_path = (root / folder_name) if root is not None else None
        if folder_path is None or not folder_path.is_dir():
            return jsonify({"status": "error", "message": "Ordner nicht gefunden."}), 404

        with connection.cursor() as cursor:
            owned = []
            for table, media_type in (("photos", "photo"), ("videos", "video")):
                cursor.execute(
                    f"""
                    SELECT id, stored_path
                    FROM {table}
                    WHERE user_id = %s AND folder = %s
                    """,
                    (user["id"], folder_name),
                )
                owned.extend(
                    (media_type, row["id"], row["stored_path"])
                    for row in cursor.fetchall()
                )
            delete_owned_media(cursor, user["id"], owned)
            cursor.execute(
                """
                DELETE FROM shares
                WHERE owner_id = %s AND kind = 'folder' AND folder = %s
                """,
                (user["id"], folder_name),
            )

        connection.commit()
        for stored_path in [row[2] for row in owned]:
            unlink_media_files(stored_path)
        shutil.rmtree(folder_path, ignore_errors=True)
        return jsonify(
            {
                "status": "ok",
                "folders": list_user_folders(user["username"]),
            }
        )
    finally:
        connection.close()

