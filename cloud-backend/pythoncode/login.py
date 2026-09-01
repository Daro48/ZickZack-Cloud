import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify, make_response
from werkzeug.security import check_password_hash
from database import get_database_connection
import os


login_bp = Blueprint("login", __name__)
SESSION_COOKIE_NAME = "session_token"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
MAX_LOGIN_ATTEMPTS = 20
LOCKOUT_MINUTES = 15

SESSION_CACHE_TTL_SECONDS = float(os.getenv("SESSION_CACHE_TTL", "30"))
SESSION_CACHE_MAX_ENTRIES = int(os.getenv("SESSION_CACHE_MAX_ENTRIES", "4096"))
SESSION_CLEANUP_INTERVAL_SECONDS = float(os.getenv("SESSION_CLEANUP_INTERVAL", "300"))

_session_cache = {}
_session_cache_lock = threading.Lock()
_last_session_cleanup = 0.0


def now_utc():
    return datetime.now(timezone.utc)


def get_client_ip():
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def delete_expired_sessions(connection):
    global _last_session_cleanup

    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()")
    _last_session_cleanup = time.monotonic()


def delete_expired_sessions_throttled(connection):
    """Aufräumen ist Wartung und darf nicht an jedem Request hängen."""
    if time.monotonic() - _last_session_cleanup < SESSION_CLEANUP_INTERVAL_SECONDS:
        return False
    delete_expired_sessions(connection)
    return True


def cache_session_user(session_token, user):
    if not session_token:
        return
    with _session_cache_lock:
        if len(_session_cache) >= SESSION_CACHE_MAX_ENTRIES:
            _session_cache.clear()
        _session_cache[session_token] = (user, time.monotonic())


def invalidate_session(session_token):
    if not session_token:
        return
    with _session_cache_lock:
        _session_cache.pop(session_token, None)


def invalidate_user_sessions(user_id):
    with _session_cache_lock:
        for token, (user, _) in list(_session_cache.items()):
            if user and user["id"] == user_id:
                del _session_cache[token]


def resolve_session_user(connection, session_token):
    """Wie get_user_by_session, aber für SESSION_CACHE_TTL_SECONDS aus dem Cache."""
    if not session_token:
        return None

    with _session_cache_lock:
        cached = _session_cache.get(session_token)
    if cached and time.monotonic() - cached[1] < SESSION_CACHE_TTL_SECONDS:
        return cached[0]

    user = get_user_by_session(connection, session_token)
    cache_session_user(session_token, user)
    return user


def get_login_attempt(connection, ip_address):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT ip_address, failed_count, locked_until
            FROM login_attempts
            WHERE ip_address = %s
            """,
            (ip_address,),
        )
        return cursor.fetchone()


def is_locked(attempt):
    if not attempt or not attempt["locked_until"]:
        return False
    locked_until = attempt["locked_until"]
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    return locked_until > now_utc()


def record_failed_login(connection, ip_address):
    attempt = get_login_attempt(connection, ip_address)
    failed_count = (attempt["failed_count"] if attempt else 0) + 1
    locked_until = None

    if failed_count >= MAX_LOGIN_ATTEMPTS:
        locked_until = now_utc() + timedelta(minutes=LOCKOUT_MINUTES)
        failed_count = 0
    
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO login_attempts (ip_address, failed_count, locked_until)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                failed_count = VALUES(failed_count),
                locked_until = VALUES(locked_until)
            """,
            (ip_address, failed_count, locked_until),
        )


def clear_login_attempts(connection, ip_address):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            DELETE FROM login_attempts WHERE ip_address = %s
            """,
            (ip_address,),
        )


def get_user_by_session(connection, session_token):
    if not session_token:
        return None

    with connection.cursor() as cursor:
        sql = """
            SELECT
                users.id,
                users.username
            FROM sessions
            INNER JOIN users ON users.id = sessions.user_id
            WHERE sessions.session_token = %s
              AND sessions.expires_at > UTC_TIMESTAMP()
        """
        cursor.execute(sql, (session_token,))
        return cursor.fetchone()


@login_bp.post("/bp/auth/login")
def login():
    data = request.get_json()

    if not data or not data.get("username") or not data.get("password"):
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Benutzername und Passwort sind erforderlich.",
                }
            ),
            400,
        )

    username = data["username"].strip()
    password = data["password"]
    ip_address = get_client_ip()
    connection = get_database_connection()

    try:
        delete_expired_sessions(connection)

        attempt = get_login_attempt(connection, ip_address)
        if is_locked(attempt):
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
                    }
                ),
                429,
            )

        with connection.cursor() as cursor:
            sql = """
                SELECT id, username, password_hash
                FROM users
                WHERE username = %s
            """
            cursor.execute(sql, (username,))
            user = cursor.fetchone()

        if not user or not check_password_hash(user["password_hash"], password):
            record_failed_login(connection, ip_address)
            connection.commit()
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Ungültiger Benutzername oder Passwort.",
                    }
                ),
                401,
            )
        clear_login_attempts(connection, ip_address)

        session_token = secrets.token_hex(32)
        expires_at = now_utc() + timedelta(days=7)
        user_agent = request.headers.get("User-Agent", "")

        with connection.cursor() as cursor:
            sql = """
                INSERT INTO sessions (session_token, user_id, expires_at, ip_address, user_agent)
                VALUES (%s, %s, %s, %s, %s)
            """
            cursor.execute(
                sql, (session_token, user["id"], expires_at, ip_address, user_agent)
            )

        connection.commit()

        from upload import ensure_user_media_root

        ensure_user_media_root(user["username"])

        response = make_response(
            jsonify(
                {
                    "status": "ok",
                    "message": "Anmeldung erfolgreich.",
                    "user": {
                        "id": user["id"],
                        "username": user["username"],
                    },
                }
            )
        )

        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=session_token,
            expires=expires_at,
            httponly=True,
            samesite="Lax",
            secure=COOKIE_SECURE,
        )

        return response

    except Exception:
        return (
            jsonify(
                {"status": "error", "message": "Anmeldung fehlgeschlagen. Bitte erneut versuchen."}
            ),
            500,
        )

    finally:
        connection.close()


@login_bp.get("/bp/auth/me")
def me():
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    connection = get_database_connection()

    try:
        delete_expired_sessions_throttled(connection)
        user = resolve_session_user(connection, session_token)
        connection.commit()

        if not user:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Nicht angemeldet",
                    }
                ),
                401,
            )

        return jsonify(
            {
                "status": "ok",
                "user": user,
            }
        )

    finally:
        connection.close()


@login_bp.post("/bp/auth/logout")
def logout():
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    connection = get_database_connection()

    try:
        delete_expired_sessions_throttled(connection)

        if session_token:
            with connection.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM sessions WHERE session_token = %s", (session_token,)
                )

        connection.commit()
        invalidate_session(session_token)

        response = make_response(
            jsonify(
                {
                    "status": "ok",
                    "message": "Abgemeldet.",
                }
            )
        )
        response.delete_cookie(
            SESSION_COOKIE_NAME,
            httponly=True,
            samesite="Lax",
            secure=COOKIE_SECURE,
        )
        return response

    finally:
        connection.close()
