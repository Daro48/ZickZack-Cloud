import os
import re
import uuid
from pathlib import Path
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
from database import get_database_connection
from login import SESSION_COOKIE_NAME, delete_expired_sessions, get_user_by_session

register_heif_opener()

upload_bp = Blueprint("upload", __name__)

MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", "/data/media"))
THUMB_MAX_EDGE = int(os.getenv("THUMB_MAX_EDGE", "512"))
THUMB_QUALITY = int(os.getenv("THUMB_QUALITY", "80"))
ALLOWED_IMAGE_PREFIXES = ("image/",)
ALLOWED_VIDEO_PREFIXES = ("video/",)
ALLOWED_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
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


def thumb_path_for(stored_path: str) -> Path:
    relative = Path(stored_path)
    return MEDIA_ROOT / relative.parent.parent / "thumbs" / f"{relative.stem}.webp"


def create_thumbnail(source: Path, stored_path: str) -> bool:
    target = thumb_path_for(stored_path)
    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((THUMB_MAX_EDGE, THUMB_MAX_EDGE))
            mode = "RGBA" if "A" in image.getbands() else "RGB"
            target.parent.mkdir(parents=True, exist_ok=True)
            image.convert(mode).save(target, "WEBP", quality=THUMB_QUALITY, method=4)
        return True
    except Exception:
        return False


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
    delete_expired_sessions(connection)
    user = get_user_by_session(connection, session_token)
    connection.commit()
    return user


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

            if media_kind == "photo":
                create_thumbnail(absolute_path, stored_path)

            table = "photos" if media_kind == "photo" else "videos"
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    INSERT INTO {table}
                        (user_id, original_name, stored_name, stored_path, mime_type, size_bytes)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        original_name,
                        stored_name,
                        stored_path,
                        mime_type,
                        size_bytes,
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
