from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash
from database import get_database_connection
from upload import ensure_user_media_root
from recovery import ensure_recovery_code_column, generate_recovery_code
import pymysql
import os


auth_bp = Blueprint("auth", __name__)
REGISTRATION_ENABLED = os.getenv("REGISTRATION_ENABLED", "true").lower() == "true"


@auth_bp.post("/bp/auth/register")
def register():
    if not REGISTRATION_ENABLED:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Registrierung ist derzeit deaktiviert.",
                }
            ),
            403,
        )

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

    if len(username) < 3:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Der Benutzername muss mindestens 3 Zeichen haben.",
                }
            ),
            400,
        )
    if len(password) < 6:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Das Passwort muss mindestens 6 Zeichen haben.",
                }
            ),
            400,
        )

    password_hash = generate_password_hash(password)
    recovery_code = generate_recovery_code()

    connection = get_database_connection()
    try:
        ensure_recovery_code_column(connection)
        connection.commit()

        with connection.cursor() as cursor:
            sql = """
                INSERT INTO users (username, password_hash, recovery_code)
                VALUES (%s, %s, %s)
            """
            cursor.execute(sql, (username, password_hash, recovery_code))

        connection.commit()
        ensure_user_media_root(username)

        return (
            jsonify(
                {
                    "status": "ok",
                    "message": "Registrierung erfolgreich.",
                    "recovery_code": recovery_code,
                }
            ),
            201,
        )

    except pymysql.err.IntegrityError:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Dieser Benutzername ist bereits vergeben.",
                }
            ),
            409,
        )

    finally:
        connection.close()
