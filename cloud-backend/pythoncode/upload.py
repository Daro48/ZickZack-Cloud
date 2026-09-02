import json
import os
import re
import subprocess
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
from database import get_database_connection
from login import (
    SESSION_COOKIE_NAME,
    delete_expired_sessions_throttled,
    resolve_session_user,
)

register_heif_opener()

# Deckelt den Speicher, den ein einzelnes Bild beim Dekodieren belegen kann.
Image.MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "80000000"))

upload_bp = Blueprint("upload", __name__)

MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", "/data/media"))
THUMB_MAX_EDGE = int(os.getenv("THUMB_MAX_EDGE", "512"))
THUMB_QUALITY = int(os.getenv("THUMB_QUALITY", "80"))
THUMB_METHOD = int(os.getenv("THUMB_METHOD", "4"))
VIDEO_THUMB_SEEK_SECONDS = os.getenv("VIDEO_THUMB_SEEK", "1")
VIDEO_THUMB_TIMEOUT_SECONDS = float(os.getenv("VIDEO_THUMB_TIMEOUT", "30"))
ALLOWED_IMAGE_PREFIXES = ("image/",)
ALLOWED_VIDEO_PREFIXES = ("video/",)
ALLOWED_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".avif",
    ".heic",
    ".heif",
    ".bmp",
    ".tif",
    ".tiff",
}
ALLOWED_VIDEO_EXTENSIONS = {
    ".mov",
    ".mp4",
    ".m4v",
    ".avi",
    ".mkv",
    ".webm",
    ".3gp",
    ".mpg",
    ".mpeg",
}
MIME_BY_EXTENSION = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".3gp": "video/3gpp",
    ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg",
}
FOLDER_NAME_RE = re.compile(r"^[A-Za-z0-9_\- ]{1,64}$")
CLIENT_KEY_RE = re.compile(r"^[a-f0-9]{16,64}$")
INCOMPLETE_DIR_NAME = ".incomplete"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024 * 1024)))
MAX_CHUNK_BYTES = 16 * 1024 * 1024
EXIF_DATETIME_TAGS = (36867, 36868, 306)


def thumb_relative_path(stored_path: str) -> Path:
    relative = Path(stored_path)
    return relative.parent.parent / "thumbs" / f"{relative.stem}.webp"


def thumb_path_for(stored_path: str) -> Path:
    return MEDIA_ROOT / thumb_relative_path(stored_path)


def write_thumbnail(image, stored_path: str) -> bool:
    target = thumb_path_for(stored_path)
    box = (THUMB_MAX_EDGE, THUMB_MAX_EDGE)

    image.thumbnail(box, Image.Resampling.LANCZOS, reducing_gap=2.0)
    mode = "RGBA" if "A" in image.getbands() else "RGB"
    if image.mode != mode:
        image = image.convert(mode)

    target.parent.mkdir(parents=True, exist_ok=True)
    # Über eine temporäre Datei schreiben: ein abgebrochener Schreibvorgang würde
    # sonst ein halbes Thumbnail hinterlassen, das danach dauerhaft als gültig
    # ausgeliefert wird.
    staging = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        image.save(staging, "WEBP", quality=THUMB_QUALITY, method=THUMB_METHOD)
        os.replace(staging, target)
    except Exception:
        staging.unlink(missing_ok=True)
        raise
    return True


def create_photo_thumbnail(source: Path, stored_path: str) -> bool:
    try:
        with Image.open(source) as image:
            # JPEG und HEIF verkleinert dekodieren, statt erst das Vollbild zu
            # laden. Bei anderen Formaten ist der Aufruf wirkungslos.
            image.draft("RGB", (THUMB_MAX_EDGE, THUMB_MAX_EDGE))
            return write_thumbnail(ImageOps.exif_transpose(image), stored_path)
    except Exception:
        return False


def extract_video_frame(source: Path, seek_seconds: str):
    command = [
        "ffmpeg",
        "-nostdin",
        "-loglevel", "error",
        "-ss", seek_seconds,
        "-i", str(source),
        "-frames:v", "1",
        "-vf", f"scale={THUMB_MAX_EDGE}:{THUMB_MAX_EDGE}"
               ":force_original_aspect_ratio=decrease",
        "-f", "image2pipe",
        "-c:v", "png",
        "-",
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            timeout=VIDEO_THUMB_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0 or not result.stdout:
        return None
    return result.stdout


def create_video_thumbnail(source: Path, stored_path: str) -> bool:
    # Der erste Frame ist häufig schwarz, bei sehr kurzen Clips gibt es dafür
    # keinen Frame an der späteren Position.
    frame = extract_video_frame(source, VIDEO_THUMB_SEEK_SECONDS)
    if not frame:
        frame = extract_video_frame(source, "0")
    if not frame:
        return False

    try:
        with Image.open(BytesIO(frame)) as image:
            return write_thumbnail(image, stored_path)
    except Exception:
        return False


def create_media_thumbnail(media_kind: str, source: Path, stored_path: str) -> bool:
    if media_kind == "video":
        return create_video_thumbnail(source, stored_path)
    return create_photo_thumbnail(source, stored_path)


def parse_capture_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, bytes):
        value = value.decode("utf-8", "ignore")
    text = str(value).strip().replace("T", " ").split(".")[0]
    if text.endswith("Z"):
        text = text[:-1]
    if len(text) >= 19:
        text = text[:19]
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def extract_photo_captured_at(source: Path):
    try:
        with Image.open(source) as image:
            exif = image.getexif()
            if not exif:
                return None
            for tag in EXIF_DATETIME_TAGS:
                parsed = parse_capture_datetime(exif.get(tag))
                if parsed:
                    return parsed
            try:
                ifd = exif.get_ifd(0x8769)
            except Exception:
                ifd = {}
            for tag in EXIF_DATETIME_TAGS:
                parsed = parse_capture_datetime(ifd.get(tag) if ifd else None)
                if parsed:
                    return parsed
    except Exception:
        return None
    return None


def extract_video_captured_at(source: Path):
    command = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_entries",
        "format_tags=creation_time:stream_tags=creation_time",
        str(source),
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            timeout=VIDEO_THUMB_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0 or not result.stdout:
        return None
    try:
        payload = json.loads(result.stdout.decode("utf-8", "ignore"))
    except ValueError:
        return None
    tags = []
    format_tags = (payload.get("format") or {}).get("tags") or {}
    tags.append(format_tags.get("creation_time") or format_tags.get("CreationTime"))
    for stream in payload.get("streams") or []:
        stream_tags = stream.get("tags") or {}
        tags.append(stream_tags.get("creation_time") or stream_tags.get("CreationTime"))
    for value in tags:
        parsed = parse_capture_datetime(value)
        if parsed:
            return parsed
    return None


def extract_captured_at(media_kind: str, source: Path):
    if media_kind == "video":
        return extract_video_captured_at(source)
    return extract_photo_captured_at(source)


def sanitize_original_name(raw_name: str | None) -> str | None:
    if raw_name is None:
        return None
    name = str(raw_name).strip()
    if not name or name in {".", ".."}:
        return None
    if "/" in name or "\\" in name or "\x00" in name:
        return None
    if len(name) > 255:
        name = name[:255].rstrip()
    return name or None


def classify_media(mime_type: str, filename: str | None = None):
    if mime_type:
        if mime_type.startswith(ALLOWED_IMAGE_PREFIXES):
            return "photo"
        if mime_type.startswith(ALLOWED_VIDEO_PREFIXES):
            return "video"

    extension = Path(filename or "").suffix.lower()
    if extension in ALLOWED_IMAGE_EXTENSIONS:
        return "photo"
    if extension in ALLOWED_VIDEO_EXTENSIONS:
        return "video"
    return None


def resolve_mime_type(mime_type: str, filename: str | None = None, media_kind: str | None = None):
    if mime_type and mime_type not in {"application/octet-stream", "binary/octet-stream"}:
        return mime_type

    extension = Path(filename or "").suffix.lower()
    guessed = MIME_BY_EXTENSION.get(extension)
    if guessed:
        return guessed
    if media_kind == "photo":
        return "image/jpeg"
    if media_kind == "video":
        return "video/mp4"
    return mime_type or "application/octet-stream"


def require_user(connection):
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if delete_expired_sessions_throttled(connection):
        connection.commit()
    return resolve_session_user(connection, session_token)


def sanitize_username_dir(username: str) -> str | None:
    if not username:
        return None
    cleaned = secure_filename(username.strip())
    return cleaned or None


def sanitize_folder_name(raw_name: str | None) -> str | None:
    if raw_name is None:
        return None
    name = str(raw_name).strip()
    if not name or name in {".", ".."}:
        return None
    if "/" in name or "\\" in name:
        return None
    if not FOLDER_NAME_RE.fullmatch(name):
        return None
    return name


def user_media_root(username: str) -> Path | None:
    safe_username = sanitize_username_dir(username)
    if not safe_username:
        return None
    return MEDIA_ROOT / safe_username


def ensure_user_media_root(username: str) -> Path | None:
    root = user_media_root(username)
    if root is None:
        return None
    root.mkdir(parents=True, exist_ok=True)
    return root


def list_user_folders(username: str) -> list[str]:
    root = ensure_user_media_root(username)
    if root is None:
        return []
    return sorted(
        entry.name
        for entry in root.iterdir()
        if entry.is_dir() and sanitize_folder_name(entry.name)
    )


def sanitize_upload_id(raw_id: str | None) -> str | None:
    value = str(raw_id or "").strip().lower()
    if len(value) != 32 or any(char not in "0123456789abcdef" for char in value):
        return None
    return value


def sanitize_client_key(raw_key: str | None) -> str | None:
    value = str(raw_key or "").strip().lower()
    if not CLIENT_KEY_RE.fullmatch(value):
        return None
    return value


def incomplete_dir(username: str) -> Path | None:
    root = ensure_user_media_root(username)
    if root is None:
        return None
    path = root / INCOMPLETE_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def incomplete_paths(username: str, upload_id: str):
    folder = incomplete_dir(username)
    if folder is None:
        return None, None
    return folder / f"{upload_id}.part", folder / f"{upload_id}.json"


def read_json_file(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None


def write_json_file(path: Path, payload: dict):
    staging = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        staging.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(staging, path)
    except Exception:
        staging.unlink(missing_ok=True)
        raise


def part_offset(part_path: Path) -> int:
    try:
        return part_path.stat().st_size
    except OSError:
        return 0


def load_upload_meta(username: str, user_id: int, upload_id: str):
    part_path, meta_path = incomplete_paths(username, upload_id)
    if meta_path is None or not meta_path.is_file():
        return None, None, None
    meta = read_json_file(meta_path)
    if not meta or meta.get("user_id") != user_id or meta.get("upload_id") != upload_id:
        return None, None, None
    return meta, part_path, meta_path


def find_upload_by_client_key(username: str, user_id: int, client_key: str):
    folder = incomplete_dir(username)
    if folder is None or not client_key:
        return None
    for path in folder.glob("*.json"):
        meta = read_json_file(path)
        if not meta:
            continue
        if meta.get("user_id") == user_id and meta.get("client_key") == client_key:
            return meta
    return None


def discard_incomplete(part_path: Path | None, meta_path: Path | None):
    if part_path is not None:
        part_path.unlink(missing_ok=True)
    if meta_path is not None:
        meta_path.unlink(missing_ok=True)


@upload_bp.get("/bp/media/folders")
def get_folders():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        folders = list_user_folders(user["username"])
        return jsonify({"status": "ok", "folders": folders})
    finally:
        connection.close()


@upload_bp.post("/bp/media/folders")
def create_folder():
    data = request.get_json(silent=True) or {}
    folder_name = sanitize_folder_name(data.get("folder") or data.get("name"))
    if not folder_name:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Ungültiger Ordnername. Erlaubt: Buchstaben, Zahlen, Leerzeichen, - und _.",
                }
            ),
            400,
        )

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        root = ensure_user_media_root(user["username"])
        if root is None:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Benutzerordner konnte nicht erstellt werden.",
                    }
                ),
                400,
            )

        folder_path = root / folder_name
        folder_path.mkdir(parents=True, exist_ok=True)

        return (
            jsonify(
                {
                    "status": "ok",
                    "message": f'Ordner "{folder_name}" ist bereit.',
                    "folder": folder_name,
                    "folders": list_user_folders(user["username"]),
                }
            ),
            201,
        )
    finally:
        connection.close()


@upload_bp.post("/bp/media/upload")
def upload_media():
    files = request.files.getlist("files")
    if not files or all(not file.filename for file in files):
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Keine Dateien ausgewählt.",
                }
            ),
            400,
        )

    folder_name = sanitize_folder_name(request.form.get("folder"))
    if not folder_name:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Bitte zuerst einen Ordner wählen oder erstellen.",
                }
            ),
            400,
        )

    connection = get_database_connection()
    saved = []
    errors = []

    try:
        user = require_user(connection)
        if not user:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Not authenticated",
                    }
                ),
                401,
            )

        user_id = user["id"]
        username = user["username"]
        from media import STORAGE_QUOTA_BYTES, used_storage_bytes

        with connection.cursor() as cursor:
            used_bytes = used_storage_bytes(cursor, user_id)
        quota_bytes = STORAGE_QUOTA_BYTES
        root = ensure_user_media_root(username)
        if root is None:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Benutzerordner konnte nicht erstellt werden.",
                    }
                ),
                400,
            )

        for file in files:
            if not file or not file.filename:
                continue

            mime_type = file.mimetype or ""
            media_kind = classify_media(mime_type, file.filename)
            if not media_kind:
                errors.append(
                    {
                        "filename": file.filename,
                        "message": "Nur Fotos und Videos sind erlaubt.",
                    }
                )
                continue

            mime_type = resolve_mime_type(mime_type, file.filename, media_kind)
            original_name = secure_filename(file.filename) or "upload"
            extension = Path(original_name).suffix.lower()
            stored_name = f"{uuid.uuid4().hex}{extension}"
            media_folder = "photos" if media_kind == "photo" else "videos"
            relative_dir = Path(root.name) / folder_name / media_folder
            absolute_dir = MEDIA_ROOT / relative_dir
            absolute_dir.mkdir(parents=True, exist_ok=True)

            absolute_path = absolute_dir / stored_name
            stored_path = str(relative_dir / stored_name).replace("\\", "/")

            file.save(absolute_path)
            size_bytes = absolute_path.stat().st_size
            if quota_bytes > 0 and used_bytes + size_bytes > quota_bytes:
                absolute_path.unlink(missing_ok=True)
                errors.append(
                    {
                        "filename": file.filename,
                        "message": "Speicherplatz ist voll.",
                    }
                )
                continue

            create_media_thumbnail(media_kind, absolute_path, stored_path)
            captured_at = extract_captured_at(media_kind, absolute_path)
            used_bytes += size_bytes

            table = "photos" if media_kind == "photo" else "videos"
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    INSERT INTO {table}
                        (user_id, original_name, stored_name, stored_path, folder,
                         mime_type, size_bytes, captured_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        original_name,
                        stored_name,
                        stored_path,
                        folder_name,
                        mime_type,
                        size_bytes,
                        captured_at,
                    ),
                )
                media_id = cursor.lastrowid
                connection.commit()

            saved.append(
                {
                    "id": media_id,
                    "type": media_kind,
                    "original_name": original_name,
                    "stored_path": stored_path,
                    "folder": folder_name,
                    "mime_type": mime_type,
                    "size_bytes": size_bytes,
                }
            )

        if not saved and errors:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Upload fehlgeschlagen.",
                        "errors": errors,
                    }
                ),
                400,
            )

        return (
            jsonify(
                {
                    "status": "ok",
                    "message": f"{len(saved)} Datei(en) hochgeladen.",
                    "folder": folder_name,
                    "uploaded": saved,
                    "errors": errors,
                }
            ),
            201,
        )

    except Exception:
        try:
            connection.rollback()
        except Exception:
            pass
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Upload fehlgeschlagen. Bitte erneut versuchen.",
                }
            ),
            500,
        )
    finally:
        connection.close()


def serialize_upload_status(meta, part_path):
    size = int(meta.get("size") or 0)
    offset = min(part_offset(part_path), size)
    return {
        "status": "ok",
        "upload_id": meta["upload_id"],
        "offset": offset,
        "size": size,
        "folder": meta.get("folder"),
        "filename": meta.get("filename"),
    }


def finalize_incomplete_upload(connection, user, meta, part_path, meta_path):
    from media import STORAGE_QUOTA_BYTES, used_storage_bytes

    folder_name = meta["folder"]
    original_name = meta["filename"]
    mime_type = meta["mime_type"]
    media_kind = meta["media_kind"]
    expected_size = int(meta["size"])
    current_size = part_offset(part_path)
    if current_size != expected_size:
        return None, "Upload ist noch nicht vollständig.", 409

    with connection.cursor() as cursor:
        used_bytes = used_storage_bytes(cursor, user["id"])
    if STORAGE_QUOTA_BYTES > 0 and used_bytes + expected_size > STORAGE_QUOTA_BYTES:
        return None, "Speicherplatz ist voll.", 400

    root = ensure_user_media_root(user["username"])
    if root is None:
        return None, "Benutzerordner konnte nicht erstellt werden.", 400

    extension = Path(original_name).suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{extension}"
    media_folder = "photos" if media_kind == "photo" else "videos"
    relative_dir = Path(root.name) / folder_name / media_folder
    absolute_dir = MEDIA_ROOT / relative_dir
    absolute_dir.mkdir(parents=True, exist_ok=True)
    absolute_path = absolute_dir / stored_name
    stored_path = str(relative_dir / stored_name).replace("\\", "/")
    part_path.replace(absolute_path)

    captured_at = extract_captured_at(media_kind, absolute_path)
    create_media_thumbnail(media_kind, absolute_path, stored_path)
    table = "photos" if media_kind == "photo" else "videos"
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            INSERT INTO {table}
                (user_id, original_name, stored_name, stored_path, folder,
                 mime_type, size_bytes, captured_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                user["id"],
                original_name,
                stored_name,
                stored_path,
                folder_name,
                mime_type,
                expected_size,
                captured_at,
            ),
        )
        media_id = cursor.lastrowid
    connection.commit()
    meta_path.unlink(missing_ok=True)
    return (
        {
            "id": media_id,
            "type": media_kind,
            "original_name": original_name,
            "stored_path": stored_path,
            "folder": folder_name,
            "mime_type": mime_type,
            "size_bytes": expected_size,
        },
        None,
        201,
    )


@upload_bp.post("/bp/media/uploads")
def init_resumable_upload():
    data = request.get_json(silent=True) or {}
    folder_name = sanitize_folder_name(data.get("folder"))
    filename = sanitize_original_name(data.get("filename") or data.get("name"))
    client_key = sanitize_client_key(data.get("client_key"))
    mime_type = str(data.get("mime_type") or "").strip()
    try:
        size = int(data.get("size"))
    except (TypeError, ValueError):
        size = 0

    if not folder_name:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Bitte zuerst einen Ordner wählen oder erstellen.",
                }
            ),
            400,
        )
    if not filename:
        return jsonify({"status": "error", "message": "Dateiname fehlt."}), 400
    if size < 1 or size > MAX_UPLOAD_BYTES:
        return jsonify({"status": "error", "message": "Ungültige Dateigröße."}), 400

    media_kind = classify_media(mime_type, filename)
    if not media_kind:
        return (
            jsonify({"status": "error", "message": "Nur Fotos und Videos sind erlaubt."}),
            400,
        )
    mime_type = resolve_mime_type(mime_type, filename, media_kind)

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401

        from media import STORAGE_QUOTA_BYTES, used_storage_bytes

        with connection.cursor() as cursor:
            used_bytes = used_storage_bytes(cursor, user["id"])
        if STORAGE_QUOTA_BYTES > 0 and used_bytes + size > STORAGE_QUOTA_BYTES:
            return jsonify({"status": "error", "message": "Speicherplatz ist voll."}), 400

        existing = find_upload_by_client_key(user["username"], user["id"], client_key)
        if (
            existing
            and int(existing.get("size") or 0) == size
            and existing.get("folder") == folder_name
        ):
            part_path, _ = incomplete_paths(user["username"], existing["upload_id"])
            return jsonify(serialize_upload_status(existing, part_path))

        upload_id = uuid.uuid4().hex
        part_path, meta_path = incomplete_paths(user["username"], upload_id)
        if part_path is None:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Benutzerordner konnte nicht erstellt werden.",
                    }
                ),
                400,
            )
        part_path.touch(exist_ok=True)
        meta = {
            "upload_id": upload_id,
            "user_id": user["id"],
            "folder": folder_name,
            "filename": filename,
            "mime_type": mime_type,
            "media_kind": media_kind,
            "size": size,
            "client_key": client_key,
        }
        write_json_file(meta_path, meta)
        return jsonify(serialize_upload_status(meta, part_path)), 201
    finally:
        connection.close()


@upload_bp.get("/bp/media/uploads/<upload_id>")
def resumable_upload_status(upload_id):
    upload_id = sanitize_upload_id(upload_id)
    if not upload_id:
        return jsonify({"status": "error", "message": "Upload nicht gefunden."}), 404

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401
        meta, part_path, _ = load_upload_meta(user["username"], user["id"], upload_id)
        if not meta:
            return jsonify({"status": "error", "message": "Upload nicht gefunden."}), 404
        return jsonify(serialize_upload_status(meta, part_path))
    finally:
        connection.close()


@upload_bp.put("/bp/media/uploads/<upload_id>")
def append_resumable_chunk(upload_id):
    upload_id = sanitize_upload_id(upload_id)
    if not upload_id:
        return jsonify({"status": "error", "message": "Upload nicht gefunden."}), 404

    try:
        offset = int(request.args.get("offset") or request.headers.get("X-Upload-Offset"))
    except (TypeError, ValueError):
        offset = None
    if offset is None or offset < 0:
        return jsonify({"status": "error", "message": "Offset fehlt."}), 400

    content_length = request.content_length
    if content_length is not None and content_length > MAX_CHUNK_BYTES:
        return jsonify({"status": "error", "message": "Chunk ist zu groß."}), 413

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401
        meta, part_path, _ = load_upload_meta(user["username"], user["id"], upload_id)
        if not meta:
            return jsonify({"status": "error", "message": "Upload nicht gefunden."}), 404

        size = int(meta["size"])
        current = part_offset(part_path)
        if offset > current:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Offset passt nicht zum gespeicherten Stand.",
                        "offset": current,
                    }
                ),
                409,
            )
        if offset < current or current >= size:
            return jsonify(serialize_upload_status(meta, part_path))

        remaining = size - current
        written = 0
        with part_path.open("ab") as handle:
            while True:
                chunk = request.stream.read(min(1024 * 1024, remaining - written))
                if not chunk:
                    break
                handle.write(chunk)
                written += len(chunk)
                if written >= MAX_CHUNK_BYTES or written >= remaining:
                    break
        if written > remaining:
            return jsonify({"status": "error", "message": "Chunk ist zu groß."}), 400

        return jsonify(serialize_upload_status(meta, part_path))
    finally:
        connection.close()


@upload_bp.post("/bp/media/uploads/<upload_id>/complete")
def complete_resumable_upload(upload_id):
    upload_id = sanitize_upload_id(upload_id)
    if not upload_id:
        return jsonify({"status": "error", "message": "Upload nicht gefunden."}), 404

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401
        meta, part_path, meta_path = load_upload_meta(
            user["username"], user["id"], upload_id
        )
        if not meta:
            return jsonify({"status": "error", "message": "Upload nicht gefunden."}), 404
        saved, message, status = finalize_incomplete_upload(
            connection, user, meta, part_path, meta_path
        )
        if saved is None:
            return jsonify({"status": "error", "message": message}), status
        return (
            jsonify(
                {
                    "status": "ok",
                    "message": "1 Datei hochgeladen.",
                    "folder": saved["folder"],
                    "uploaded": [saved],
                    "errors": [],
                }
            ),
            status,
        )
    except Exception:
        try:
            connection.rollback()
        except Exception:
            pass
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Upload fehlgeschlagen. Bitte erneut versuchen.",
                }
            ),
            500,
        )
    finally:
        connection.close()


@upload_bp.delete("/bp/media/uploads/<upload_id>")
def discard_resumable_upload(upload_id):
    upload_id = sanitize_upload_id(upload_id)
    if not upload_id:
        return jsonify({"status": "error", "message": "Upload nicht gefunden."}), 404

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Not authenticated"}), 401
        meta, part_path, meta_path = load_upload_meta(
            user["username"], user["id"], upload_id
        )
        if not meta:
            return jsonify({"status": "ok"})
        discard_incomplete(part_path, meta_path)
        return jsonify({"status": "ok"})
    finally:
        connection.close()
