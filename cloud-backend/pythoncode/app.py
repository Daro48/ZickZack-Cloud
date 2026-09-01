import gzip
import os
from flask import Flask, jsonify, request
from werkzeug.middleware.proxy_fix import ProxyFix
from database import get_database_connection
from login import login_bp
from registration import auth_bp
from recovery import recovery_bp
from media import media_bp
from community import community_bp
from upload import upload_bp
from schema import run_startup_migrations

GZIP_MIN_BYTES = int(os.getenv("GZIP_MIN_BYTES", "1024"))

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config["MAX_CONTENT_LENGTH"] = int(
    os.getenv("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024 * 1024))
)

app.register_blueprint(auth_bp)
app.register_blueprint(login_bp)
app.register_blueprint(recovery_bp)
app.register_blueprint(upload_bp)
app.register_blueprint(media_bp)
app.register_blueprint(community_bp)

run_startup_migrations()


@app.after_request
def compress_json_responses(response):
    """Nur JSON komprimieren. Fotos und Videos sind bereits komprimiert und gehen
    als Datei-Stream raus, der nicht angefasst werden darf."""
    if response.mimetype != "application/json" or response.direct_passthrough:
        return response
    if response.status_code >= 300 or response.content_encoding:
        return response
    if "gzip" not in request.headers.get("Accept-Encoding", ""):
        return response

    payload = response.get_data()
    if len(payload) < GZIP_MIN_BYTES:
        return response

    response.set_data(gzip.compress(payload, 6))
    response.content_encoding = "gzip"
    response.vary.add("Accept-Encoding")
    return response


@app.get("/bp/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/bp/db")
def database_test():
    connection = get_database_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT DATABASE() AS current_db")
            result = cursor.fetchone()
        return jsonify({
            "status": "ok",
            "connected_to": result["current_db"]
        })
    except Exception:
        return jsonify({
            "status": "error",
            "message": "Database connection failed! Please try again."
        }), 500
    finally:
        connection.close()


if __name__ == "__main__":
    from waitress import serve

    threads = int(os.getenv("WAITRESS_THREADS", "16"))
    serve(app, host="0.0.0.0", port=5000, threads=threads, channel_timeout=3600)
