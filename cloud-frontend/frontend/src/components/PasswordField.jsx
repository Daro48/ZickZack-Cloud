export function PasswordField({
  autoComplete,
  disabled,
  minLength,
  name,
  onChange,
  placeholder,
  required,
  value,
  visible,
  onToggleVisible,
}) {
  return (
    <span className="password-field">
      <input
        autoComplete={autoComplete}
        disabled={disabled}
        minLength={minLength}
        name={name}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        type={visible ? 'text' : 'password'}
        value={value}
      />
      <button
        aria-label={visible ? 'Passwort verbergen' : 'Passwort anzeigen'}
        aria-pressed={visible}
        className="password-toggle"
        onClick={onToggleVisible}
        type="button"
      >
        {visible ? 'Verbergen' : 'Anzeigen'}
      </button>
    </span>
  )
}
