from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash
from database import get_database_connection
import hmac
import pymysql
import secrets


recovery_bp = Blueprint("recovery", __name__)
RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_recovery_code():
    raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_recovery_code(value):
    if not value:
        return ""
    cleaned = "".join(character for character in value.strip().upper() if character.isalnum())
    if len(cleaned) != 8:
        return cleaned
    return f"{cleaned[:4]}-{cleaned[4:]}"


def ensure_recovery_code_column(connection):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT COUNT(*) AS column_count
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'users'
              AND COLUMN_NAME = 'recovery_code'
            """
        )
        if cursor.fetchone()["column_count"]:
            return

        cursor.execute(
            """
            ALTER TABLE users
            ADD COLUMN recovery_code VARCHAR(16) NULL UNIQUE
            """
        )

    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM users WHERE recovery_code IS NULL")
        users = cursor.fetchall()

    for user in users:
        while True:
            code = generate_recovery_code()
            with connection.cursor() as cursor:
                try:
                    cursor.execute(
                        "UPDATE users SET recovery_code = %s WHERE id = %s",
                        (code, user["id"]),
                    )
                    break
                except pymysql.err.IntegrityError:
                    continue


@recovery_bp.post("/bp/auth/reset-password")
def reset_password():
    data = request.get_json()

    if (
        not data
        or not data.get("username")
        or not data.get("recovery_code")
        or not data.get("password")
    ):
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Username, recovery code and password are required",
                }
            ),
            400,
        )

    username = data["username"].strip()
    recovery_code = normalize_recovery_code(data["recovery_code"])
    password = data["password"]

    if len(password) < 6:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Password must be at least 6 characters long",
                }
            ),
            400,
        )

    connection = get_database_connection()
    try:
        ensure_recovery_code_column(connection)
        connection.commit()

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, recovery_code
                FROM users
                WHERE username = %s
                """,
                (username,),
            )
            user = cursor.fetchone()

        stored_code = normalize_recovery_code((user or {}).get("recovery_code"))
        if (
            not user
            or not stored_code
            or len(stored_code) != len(recovery_code)
            or not hmac.compare_digest(stored_code, recovery_code)
        ):
            connection.commit()
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "Invalid username or recovery code",
                    }
                ),
                401,
            )

        password_hash = generate_password_hash(password)

        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (password_hash, user["id"]),
            )
            cursor.execute(
                "DELETE FROM sessions WHERE user_id = %s",
                (user["id"],),
            )

        connection.commit()

        return jsonify(
            {
                "status": "ok",
                "message": "Password updated. You can log in now.",
            }
        )

    except Exception:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Could not reset password. Please try again.",
                }
            ),
            500,
        )

    finally:
        connection.close()
