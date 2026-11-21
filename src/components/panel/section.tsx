import { useState } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';

interface SectionProps {
  title: string;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
  /** When provided, shows a reset button in the header. */
  onReset?: () => void;
  children: React.ReactNode;
}

const COLLAPSED_KEY = 'walksnail-osd-studio:collapsed-sections';

/** Titles of sections the user has collapsed (per-browser convenience). */
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(title: string, collapsed: boolean) {
  try {
    const set = readCollapsed();
    if (collapsed) set.add(title);
    else set.delete(title);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable: collapse still works for this session */
  }
}

/**
 * Sidebar panel with a title and an optional header checkbox. Clicking the
 * header collapses or expands the content (remembered across reloads). When
 * the toggle is unchecked the content is hidden regardless.
 */
export function Section({ title, toggle, onReset, children }: SectionProps) {
  const [open, setOpen] = useState(() => !readCollapsed().has(title));
  const enabled = toggle ? toggle.checked : true;
  const expanded = open && enabled;

  const toggleOpen = () => {
    if (!enabled) return;
    setOpen((v) => {
      writeCollapsed(title, v);
      return !v;
    });
  };

  return (
    <section className={`panel ${expanded ? '' : 'panel--collapsed'}`}>
      <div
        className={`panel__head ${enabled ? 'panel__head--clickable' : ''}`}
        onClick={toggleOpen}
      >
        <h2>
          <button
            type="button"
            className="panel__title"
            aria-expanded={expanded}
            disabled={!enabled}
          >
            <ChevronRight size={14} className="panel__chevron" aria-hidden="true" />
            {title}
          </button>
        </h2>
        {/* Actions keep their own clicks from toggling the section. */}
        <div className="panel__actions" onClick={(e) => e.stopPropagation()}>
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
      {expanded && children}
    </section>
  );
}
