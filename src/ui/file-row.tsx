interface FileRowProps {
  label: string;
  name?: string;
}

/** A label/value row for the Files panel; shows an em-dash when unset. */
export function FileRow({ label, name }: FileRowProps) {
  return (
    <div className="filerow">
      <span className="filerow__label">{label}</span>
      <span className={`filerow__name ${name ? '' : 'muted'}`}>{name ?? '—'}</span>
    </div>
  );
}
