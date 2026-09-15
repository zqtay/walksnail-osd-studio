import { RotateCcw } from 'lucide-react';

interface SectionProps {
  title: string;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
  /** When provided, shows a reset button in the header. */
  onReset?: () => void;
  children: React.ReactNode;
}

/**
 * Sidebar panel with a title and an optional header checkbox. When the toggle
 * is unchecked the section content is hidden (collapsed to the title row).
 */
export function Section({ title, toggle, onReset, children }: SectionProps) {
  const collapsed = toggle ? !toggle.checked : false;
  return (
    <section className={`panel ${collapsed ? 'panel--collapsed' : ''}`}>
      <div className="panel__head">
        <h2>{title}</h2>
        <div className="panel__actions">
          {onReset && (
            <button
              type="button"
              className="panel__reset"
              onClick={onReset}
              title={`Reset ${title} to defaults`}
              aria-label={`Reset ${title} to defaults`}
            >
              <RotateCcw size={14} />
            </button>
          )}
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
      </div>
      {!collapsed && children}
    </section>
  );
}
