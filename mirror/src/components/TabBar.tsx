import { useMirror } from '../lib/store'

/**
 * Bottom mode bar — the mobile-console pattern Elliot picked. Lessons from the
 * 08-15 controller session are load-bearing here: ≤5 primary tabs so every tab
 * clears ~68px width on a 375px screen, 44px minimum height, icon + label
 * (never icon-only: accessible-name drift faked unclickable tabs in testing).
 */
export function TabBar() {
  const pages = useMirror((s) => s.layout.pages)
  const active = useMirror((s) => s.activePageId)
  const setActive = useMirror((s) => s.setActivePage)
  const editMode = useMirror((s) => s.editMode)
  const toggleEdit = useMirror((s) => s.toggleEdit)

  return (
    <nav className="tabbar" aria-label="Console modes">
      {pages.map((p) => (
        <button
          key={p.id}
          className={`tab ${p.id === active ? 'tab-active' : ''}`}
          aria-current={p.id === active ? 'page' : undefined}
          data-qa-idx={p.id}
          onClick={() => setActive(p.id)}
        >
          <span className="tab-icon" aria-hidden>
            {p.icon}
          </span>
          <span className="tab-label">{p.label}</span>
        </button>
      ))}
      <button className={`tab tab-edit ${editMode ? 'tab-active' : ''}`} onClick={toggleEdit} data-qa-idx="edit">
        <span className="tab-icon" aria-hidden>
          {editMode ? '✓' : '✎'}
        </span>
        <span className="tab-label">{editMode ? 'Done' : 'Edit'}</span>
      </button>
    </nav>
  )
}
