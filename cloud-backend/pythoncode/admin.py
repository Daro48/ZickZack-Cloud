from flask import Blueprint, jsonify
from database import get_database_connection
from login import is_admin_username
from upload import require_user

admin_bp = Blueprint("admin", __name__)


def format_last_seen(value):
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


@admin_bp.get("/bp/admin/users")
def list_admin_users():
    connection = get_database_connection()
    try:
        user = require_user(connection)
        if not user:
            return jsonify({"status": "error", "message": "Nicht angemeldet"}), 401
        if not is_admin_username(user.get("username")):
            return jsonify({"status": "error", "message": "Keine Berechtigung."}), 403

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, username, last_seen_at
                FROM users
                ORDER BY username
                """
            )
            rows = cursor.fetchall()

        return jsonify(
            {
                "status": "ok",
                "users": [
                    {
                        "id": row["id"],
                        "username": row["username"],
                        "last_seen_at": format_last_seen(row.get("last_seen_at")),
                    }
                    for row in rows
                ],
            }
        )
    finally:
        connection.close()
