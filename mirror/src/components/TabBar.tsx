import { useMirror, TREE_TAB } from '../lib/store'

/**
 * Bottom mode bar — TouchConsole's pattern, faithfully: fixed nav, 52px min
 * tab height, amber active state, icon + label (never icon-only: accessible-
 * name drift faked unclickable tabs in the 08-15 session). Tree is always
 * first; tapping an open sheet's tab closes it back to the Tree.
 */
export function TabBar() {
  const pages = useMirror((s) => s.layout.pages)
  const active = useMirror((s) => s.activePageId)
  const setActive = useMirror((s) => s.setActivePage)
  const editMode = useMirror((s) => s.editMode)
  const toggleEdit = useMirror((s) => s.toggleEdit)

  return (
    <nav className="tabbar" aria-label="Console modes">
      <button
        className={`tab ${active === TREE_TAB ? 'tab-active' : ''}`}
        aria-current={active === TREE_TAB ? 'page' : undefined}
        data-qa-idx="tree"
        onClick={() => setActive(TREE_TAB)}
      >
        <span className="tab-icon" aria-hidden>
          🌳
        </span>
        <span className="tab-label">Tree</span>
      </button>
      {pages.map((p) => (
        <button
          key={p.id}
          className={`tab ${p.id === active ? 'tab-active' : ''}`}
          aria-current={p.id === active ? 'page' : undefined}
          data-qa-idx={p.id}
          onClick={() => setActive(p.id === active ? TREE_TAB : p.id)}
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
