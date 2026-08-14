from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash
from database import get_database_connection
from upload import ensure_user_media_root
import pymysql


auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/bp/auth/register")
def register():
    data = request.get_json()

    if not data or not data.get("username") or not data.get("password"):
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Username and password are required",
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
                    "message": "Username must be at least 3 characters long",
                }
            ),
            400,
        )
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

    password_hash = generate_password_hash(password)

    connection = get_database_connection()
    try:
        with connection.cursor() as cursor:
            sql = "INSERT INTO users (username, password_hash) VALUES (%s, %s)"
            cursor.execute(sql, (username, password_hash))

        connection.commit()
        ensure_user_media_root(username)

        return jsonify({"status": "ok", "message": "Registration successful!"}), 201

    except pymysql.err.IntegrityError:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "User already exists",
                }
            ),
            409,
        )

    finally:
        connection.close()
