from flask import Blueprint, jsonify, request
from database import get_database_connection
from login import ADMIN_USERNAME, is_admin_username
from upload import require_user

feedback_bp = Blueprint("feedback", __name__)
MAX_BODY_LENGTH = 1000
VALID_ADMIN_AUDIENCES = {"user", "all"}


def public_error(message, status):
    return jsonify({"status": "error", "message": message}), status


def format_created_at(value):
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def serialize_message(row, current_user_id):
    return {
        "id": row["id"],
        "body": row["body"],
        "created_at": format_created_at(row.get("created_at")),
        "username": row["username"],
        "sender_id": row["user_id"],
        "audience": row["audience"],
        "recipient_id": row["recipient_id"],
        "recipient_username": row.get("recipient_username"),
        "mine": row["user_id"] == current_user_id,
    }


def load_user_by_id(cursor, user_id):
    cursor.execute(
        "SELECT id, username FROM users WHERE id = %s",
        (user_id,),
    )
    return cursor.fetchone()


def load_admin_user(cursor):
    cursor.execute(
        "SELECT id, username FROM users WHERE LOWER(username) = %s",
        (ADMIN_USERNAME,),
    )
    return cursor.fetchone()


def notify_about_message(cursor, sender, audience, recipient_id):
    message = f"{sender['username']} hat dir eine Nachricht geschrieben."
    if len(message) > 255:
        message = message[:255]

    if audience == "admin":
        admin = load_admin_user(cursor)
        if not admin or admin["id"] == sender["id"]:
            return
        target_ids = [admin["id"]]
    elif audience == "user":
        if not recipient_id or recipient_id == sender["id"]:
            return
        target_ids = [recipient_id]
    elif audience == "all":
        cursor.execute(
            "SELECT id FROM users WHERE id != %s",
            (sender["id"],),
        )
        target_ids = [row["id"] for row in cursor.fetchall()]
    else:
        return

    if not target_ids:
        return

    cursor.executemany(
        """
        INSERT INTO notifications (user_id, share_id, message)
        VALUES (%s, NULL, %s)
        """,
        [(user_id, message) for user_id in target_ids],
    )


@feedback_bp.post("/bp/feedback")
def create_feedback():
    data = request.get_json(silent=True) or {}
    body = str(data.get("body") or "").strip()

    if not body:
        return public_error("Bitte schreib eine Nachricht.", 400)
    if len(body) > MAX_BODY_LENGTH:
        return public_error(
            f"Die Nachricht darf höchstens {MAX_BODY_LENGTH} Zeichen haben.",
            400,
        )

    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return public_error("Nicht angemeldet", 401)

        is_admin = is_admin_username(user.get("username"))
        recipient_id = None
        if is_admin:
            audience = str(data.get("audience") or "").strip().lower()
            if audience not in VALID_ADMIN_AUDIENCES:
                return public_error(
                    "Bitte wähle einen Empfänger oder alle User.",
                    400,
                )
            if audience == "user":
                raw_recipient = data.get("recipient_id")
                try:
                    recipient_id = int(raw_recipient)
                except (TypeError, ValueError):
                    return public_error("Bitte wähle einen User.", 400)
                if recipient_id == user["id"]:
                    return public_error(
                        "Eine Antwort an dich selbst ist nicht möglich.",
                        400,
                    )
                with connection.cursor() as cursor:
                    recipient = load_user_by_id(cursor, recipient_id)
                if not recipient:
                    return public_error("Dieser User existiert nicht.", 400)
        else:
            audience = "admin"

        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO admin_messages (user_id, recipient_id, audience, body)
                VALUES (%s, %s, %s, %s)
                """,
                (user["id"], recipient_id, audience, body),
            )
            notify_about_message(cursor, user, audience, recipient_id)
        connection.commit()
        return jsonify({"status": "ok", "message": "Nachricht gesendet."})
    finally:
        connection.close()


@feedback_bp.get("/bp/feedback")
def list_feedback():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return public_error("Nicht angemeldet", 401)

        is_admin = is_admin_username(user.get("username"))
        with connection.cursor() as cursor:
            if is_admin:
                cursor.execute(
                    """
                    SELECT
                        messages.id,
                        messages.user_id,
                        messages.recipient_id,
                        messages.audience,
                        messages.body,
                        messages.created_at,
                        senders.username,
                        recipients.username AS recipient_username
                    FROM admin_messages AS messages
                    INNER JOIN users AS senders
                        ON senders.id = messages.user_id
                    LEFT JOIN users AS recipients
                        ON recipients.id = messages.recipient_id
                    WHERE messages.audience = 'admin'
                       OR messages.user_id = %s
                    ORDER BY messages.created_at DESC, messages.id DESC
                    LIMIT 200
                    """,
                    (user["id"],),
                )
            else:
                cursor.execute(
                    """
                    SELECT
                        messages.id,
                        messages.user_id,
                        messages.recipient_id,
                        messages.audience,
                        messages.body,
                        messages.created_at,
                        senders.username,
                        recipients.username AS recipient_username
                    FROM admin_messages AS messages
                    INNER JOIN users AS senders
                        ON senders.id = messages.user_id
                    LEFT JOIN users AS recipients
                        ON recipients.id = messages.recipient_id
                    WHERE messages.audience = 'all'
                       OR (
                            messages.audience = 'user'
                            AND messages.recipient_id = %s
                       )
                       OR (
                            messages.audience = 'admin'
                            AND messages.user_id = %s
                       )
                    ORDER BY messages.created_at DESC, messages.id DESC
                    LIMIT 200
                    """,
                    (user["id"], user["id"]),
                )
            rows = cursor.fetchall()

        return jsonify(
            {
                "status": "ok",
                "is_admin": is_admin,
                "messages": [
                    serialize_message(row, user["id"]) for row in rows
                ],
            }
        )
    finally:
        connection.close()
