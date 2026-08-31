import os
import queue
import threading
import time
import pymysql

DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "16"))
DB_POOL_TIMEOUT_SECONDS = float(os.getenv("DB_POOL_TIMEOUT", "10"))
DB_POOL_PING_INTERVAL_SECONDS = float(os.getenv("DB_POOL_PING_INTERVAL", "30"))


class PoolExhausted(RuntimeError):
    pass


def open_raw_connection():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "db"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
        cursorclass=pymysql.cursors.DictCursor,
    )


class PooledConnection:
    """Verhält sich wie eine PyMySQL-Verbindung, close() gibt sie an den Pool zurück."""

    def __init__(self, pool, raw):
        self._pool = pool
        self._raw = raw

    def cursor(self, *args, **kwargs):
        return self._raw.cursor(*args, **kwargs)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        pool = self._pool
        raw = self._raw
        self._pool = None
        self._raw = None
        if pool is not None and raw is not None:
            pool.release(raw)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
        return False


class ConnectionPool:
    def __init__(self, size):
        self._size = max(1, size)
        self._idle = queue.LifoQueue()
        self._lock = threading.Lock()
        self._live = 0

    def acquire(self):
        deadline = time.monotonic() + DB_POOL_TIMEOUT_SECONDS

        while True:
            raw = self._take_idle()
            if raw is not None:
                return PooledConnection(self, raw)

            raw = self._open_below_limit()
            if raw is not None:
                return PooledConnection(self, raw)

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise PoolExhausted("Keine freie Datenbankverbindung verfügbar.")
            try:
                entry = self._idle.get(timeout=remaining)
            except queue.Empty:
                continue
            if self._revive(entry):
                return PooledConnection(self, entry[0])

    def release(self, raw):
        try:
            raw.rollback()
        except Exception:
            self._drop(raw)
            return
        self._idle.put((raw, time.monotonic()))

    def _take_idle(self):
        while True:
            try:
                entry = self._idle.get_nowait()
            except queue.Empty:
                return None
            if self._revive(entry):
                return entry[0]

    def _revive(self, entry):
        raw, released_at = entry
        # Nur länger untätige Verbindungen prüfen, der Ping kostet einen Roundtrip.
        if time.monotonic() - released_at < DB_POOL_PING_INTERVAL_SECONDS:
            return True
        try:
            raw.ping(reconnect=True)
            return True
        except Exception:
            self._drop(raw)
            return False

    def _open_below_limit(self):
        with self._lock:
            if self._live >= self._size:
                return None
            self._live += 1
        try:
            return open_raw_connection()
        except Exception:
            with self._lock:
                self._live -= 1
            raise

    def _drop(self, raw):
        with self._lock:
            self._live -= 1
        try:
            raw.close()
        except Exception:
            pass


_pool = ConnectionPool(DB_POOL_SIZE)


def get_database_connection():
    return _pool.acquire()
