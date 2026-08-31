from database import get_database_connection
from upload import MEDIA_ROOT, create_thumbnail, thumb_path_for


def main():
    connection = get_database_connection()
    created = 0
    skipped = 0
    failed = 0

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id, stored_path FROM photos ORDER BY id")
            rows = cursor.fetchall()

        total = len(rows)
        print(f"{total} Fotos gefunden.")

        for index, row in enumerate(rows, start=1):
            stored_path = row["stored_path"]

            if thumb_path_for(stored_path).is_file():
                skipped += 1
            elif not (MEDIA_ROOT / stored_path).is_file():
                failed += 1
            elif create_thumbnail(MEDIA_ROOT / stored_path, stored_path):
                created += 1
            else:
                failed += 1

            if index % 100 == 0 or index == total:
                print(f"{index}/{total}")

        print(f"Erstellt: {created}, vorhanden: {skipped}, fehlgeschlagen: {failed}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
