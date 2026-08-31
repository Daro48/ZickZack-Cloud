import os
from concurrent.futures import ProcessPoolExecutor
from database import get_database_connection
from upload import MEDIA_ROOT, create_media_thumbnail, thumb_path_for

# Nach oben begrenzt, weil jeder Prozess ein ganzes Bild im Speicher dekodiert.
BACKFILL_WORKERS = int(
    os.getenv("BACKFILL_WORKERS", str(max(1, min((os.cpu_count() or 2) - 1, 4))))
)


def build_one(job):
    media_kind, stored_path = job

    if thumb_path_for(stored_path).is_file():
        return "skipped"

    source = MEDIA_ROOT / stored_path
    if not source.is_file():
        return "failed"

    return "created" if create_media_thumbnail(media_kind, source, stored_path) else "failed"


def load_jobs():
    connection = get_database_connection()
    try:
        jobs = []
        with connection.cursor() as cursor:
            for media_kind, table in (("photo", "photos"), ("video", "videos")):
                cursor.execute(f"SELECT stored_path FROM {table} ORDER BY id")
                jobs.extend((media_kind, row["stored_path"]) for row in cursor.fetchall())
        return jobs
    finally:
        connection.close()


def main():
    jobs = load_jobs()
    total = len(jobs)
    photos = sum(1 for kind, _ in jobs if kind == "photo")
    print(
        f"{total} Dateien gefunden ({photos} Fotos, {total - photos} Videos), "
        f"{BACKFILL_WORKERS} Prozess(e)."
    )

    if not total:
        return

    counts = {"created": 0, "skipped": 0, "failed": 0}
    with ProcessPoolExecutor(max_workers=BACKFILL_WORKERS) as pool:
        for index, outcome in enumerate(pool.map(build_one, jobs, chunksize=8), start=1):
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
