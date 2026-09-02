import { useEffect, useId, useRef, useState } from 'react'

export function SelectMenu({
  label,
  value,
  onChange,
  options,
  disabled = false,
  placement = 'bottom',
  accent = false,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef(null)
  const labelId = useId()
  const selected =
    options.find((option) => option.value === value) || options[0]

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className={`folder-field${accent ? ' is-accent' : ''}`} ref={rootRef}>
      {label && (
        <span className="folder-field-label" id={labelId}>
          {label}
        </span>
      )}
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-labelledby={label ? labelId : undefined}
        className={`folder-select-trigger${isOpen ? ' is-open' : ''}${
          accent ? ' is-accent' : ''
        }`}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="folder-select-value">{selected?.label}</span>
        <span aria-hidden="true" className="folder-select-caret" />
      </button>
      {isOpen && (
        <div
          className={`folder-select-panel${
            placement === 'top' ? ' is-above' : ''
          }`}
          role="listbox"
          aria-label={label}
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={`folder-select-option${
                option.value === value ? ' is-active' : ''
              }`}
              key={option.value}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              role="option"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
