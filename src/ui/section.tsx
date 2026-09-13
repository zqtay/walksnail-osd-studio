interface SectionProps {
  title: string;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
  children: React.ReactNode;
}

/**
 * Sidebar panel with a title and an optional header checkbox. When the toggle
 * is unchecked the section content is hidden (collapsed to the title row).
 */
export function Section({ title, toggle, children }: SectionProps) {
  const collapsed = toggle ? !toggle.checked : false;
  return (
    <section className={`panel ${collapsed ? 'panel--collapsed' : ''}`}>
      <div className="panel__head">
        <h2>{title}</h2>
        {toggle && (
          <input
            type="checkbox"
            className="panel__toggle"
            checked={toggle.checked}
            onChange={(e) => toggle.onChange(e.target.checked)}
            aria-label={`Toggle ${title}`}
          />
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}
