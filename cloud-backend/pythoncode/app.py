import os
from flask import Flask, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
from database import get_database_connection
from login import login_bp
from registration import auth_bp
from media import media_bp
from upload import upload_bp

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config["MAX_CONTENT_LENGTH"] = int(
    os.getenv("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024 * 1024))
)

app.register_blueprint(auth_bp)
app.register_blueprint(login_bp)
app.register_blueprint(upload_bp)
app.register_blueprint(media_bp)

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

    threads = int(os.getenv("WAITRESS_THREADS", "8"))
    serve(app, host="0.0.0.0", port=5000, threads=threads, channel_timeout=3600)
