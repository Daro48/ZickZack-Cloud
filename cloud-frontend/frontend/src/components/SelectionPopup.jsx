export function SelectionPopup({
  count,
  deleteLabel,
  onClear,
  onSelectAll,
  onShare,
  onMove,
  onRename,
  onRestore,
  onDelete,
}) {
  if (count < 1) {
    return null
  }

  return (
    <div className="selection-popup" role="region" aria-label="Auswahl">
      <p className="selection-popup-count">
        {count === 1 ? '1 Datei' : `${count} Dateien`}
      </p>
      <div className="selection-popup-actions">
        {onSelectAll && (
          <button className="ghost-button" onClick={onSelectAll} type="button">
            Alle
          </button>
        )}
        <button className="ghost-button" onClick={onClear} type="button">
          Aufheben
        </button>
        {onDelete && (
          <button className="danger-button" onClick={onDelete} type="button">
            {deleteLabel ||
              (count === 1 ? 'Datei löschen' : `${count} Dateien löschen`)}
          </button>
        )}
        {onRestore && (
          <button className="secondary-button" onClick={onRestore} type="button">
            Wiederherstellen
          </button>
        )}
        {onRename && (
          <button className="ghost-button" onClick={onRename} type="button">
            Umbenennen
          </button>
        )}
        {onMove && (
          <button className="secondary-button" onClick={onMove} type="button">
            Verschieben
          </button>
        )}
        {onShare && (
          <button className="primary-button" onClick={onShare} type="button">
            {count} teilen
          </button>
        )}
      </div>
    </div>
  )
}
