import os
from concurrent.futures import ProcessPoolExecutor
from database import get_database_connection
from upload import MEDIA_ROOT, create_thumbnail, thumb_path_for

# Nach oben begrenzt, weil jeder Prozess ein ganzes Bild im Speicher dekodiert.
BACKFILL_WORKERS = int(
    os.getenv("BACKFILL_WORKERS", str(max(1, min((os.cpu_count() or 2) - 1, 4))))
)


def build_one(stored_path):
    if thumb_path_for(stored_path).is_file():
        return "skipped"

    source = MEDIA_ROOT / stored_path
    if not source.is_file():
        return "failed"

    return "created" if create_thumbnail(source, stored_path) else "failed"


def load_photo_paths():
    connection = get_database_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT stored_path FROM photos ORDER BY id")
            return [row["stored_path"] for row in cursor.fetchall()]
    finally:
        connection.close()


def main():
    paths = load_photo_paths()
    total = len(paths)
    print(f"{total} Fotos gefunden, {BACKFILL_WORKERS} Prozess(e).")

    if not total:
        return

    counts = {"created": 0, "skipped": 0, "failed": 0}
    with ProcessPoolExecutor(max_workers=BACKFILL_WORKERS) as pool:
        for index, outcome in enumerate(pool.map(build_one, paths, chunksize=8), start=1):
            counts[outcome] += 1
            if index % 100 == 0 or index == total:
                print(f"{index}/{total}")

    print(
        f"Erstellt: {counts['created']}, "
        f"vorhanden: {counts['skipped']}, "
        f"fehlgeschlagen: {counts['failed']}"
    )


if __name__ == "__main__":
    main()
