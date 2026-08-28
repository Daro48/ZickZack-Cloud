const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mrz',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
]

export function TimelinePicker({
  years,
  months,
  weeks,
  selectedYear,
  selectedMonth,
  selectedWeek,
  openPanel,
  onTogglePanel,
  onSelectYear,
  onSelectMonth,
  onSelectWeek,
}) {
  const yearLabel = selectedYear || 'Jahr'
  const monthLabel = selectedMonth
    ? MONTH_NAMES[Number(selectedMonth) - 1]
    : 'Monat'
  const weekLabel = selectedWeek
    ? `Woche ${selectedWeek}`
    : 'Woche'

  return (
    <section className="timeline" aria-label="Zeitnavigation">
      <div className="picker-steps">
        <button
          className={`picker-step ${openPanel === 'year' ? 'is-open' : ''} ${
            selectedYear ? 'has-value' : ''
          }`}
          onClick={() => onTogglePanel('year')}
          type="button"
        >
          <span className="picker-step-kicker">01</span>
          <span className="picker-step-label">Jahr</span>
          <span className="picker-step-value">
            <span className="picker-value-full">{yearLabel}</span>
            <span className="picker-value-short">{selectedYear || 'Jahr'}</span>
          </span>
        </button>

        <button
          className={`picker-step ${openPanel === 'month' ? 'is-open' : ''} ${
            selectedMonth ? 'has-value' : ''
          }`}
          disabled={!selectedYear}
          onClick={() => onTogglePanel('month')}
          type="button"
        >
          <span className="picker-step-kicker">02</span>
          <span className="picker-step-label">Monat</span>
          <span className="picker-step-value">
            <span className="picker-value-full">{monthLabel}</span>
            <span className="picker-value-short">
              {selectedMonth ? MONTH_SHORT[Number(selectedMonth) - 1] : 'Mon'}
            </span>
          </span>
        </button>

        <button
          className={`picker-step ${openPanel === 'week' ? 'is-open' : ''} ${
            selectedWeek ? 'has-value' : ''
          }`}
          disabled={!selectedYear || !selectedMonth}
          onClick={() => onTogglePanel('week')}
          type="button"
        >
          <span className="picker-step-kicker">03</span>
          <span className="picker-step-label">Woche</span>
          <span className="picker-step-value">
            <span className="picker-value-full">{weekLabel}</span>
            <span className="picker-value-short">
              {selectedWeek ? `W${selectedWeek}` : 'Wo'}
            </span>
          </span>
        </button>
      </div>

      {openPanel === 'year' && (
        <div className="picker-panel" role="listbox" aria-label="Jahr wählen">
          <div className="picker-grid picker-grid-years">
            {years.map((year) => (
              <button
                key={year}
                className={`picker-tile ${
                  Number(selectedYear) === year ? 'is-active' : ''
                }`}
                onClick={() => onSelectYear(year)}
                type="button"
              >
                {year}
              </button>
            ))}
          </div>
        </div>
      )}

      {openPanel === 'month' && (
        <div className="picker-panel" role="listbox" aria-label="Monat wählen">
          <div className="picker-grid picker-grid-months">
            {months.map((month) => (
              <button
                key={month}
                className={`picker-tile picker-tile-month ${
                  Number(selectedMonth) === month ? 'is-active' : ''
                }`}
                onClick={() => onSelectMonth(month)}
                type="button"
              >
                <span>{MONTH_SHORT[month - 1]}</span>
                <strong>{MONTH_NAMES[month - 1]}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {openPanel === 'week' && (
        <div className="picker-panel" role="listbox" aria-label="Woche wählen">
          <div className="picker-week-list">
            {weeks.map((entry) => (
              <button
                key={entry.week}
                className={`picker-week ${
                  Number(selectedWeek) === entry.week ? 'is-active' : ''
                }`}
                onClick={() => onSelectWeek(entry.week)}
                type="button"
              >
                <span className="picker-week-num">W{entry.week}</span>
                <span className="picker-week-range">{entry.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export { MONTH_NAMES }
