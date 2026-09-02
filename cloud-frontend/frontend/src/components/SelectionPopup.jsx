export function SelectionPopup({
  count,
  onClear,
  onSelectAll,
  onShare,
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
            {count === 1 ? 'Datei löschen' : `${count} Dateien löschen`}
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
