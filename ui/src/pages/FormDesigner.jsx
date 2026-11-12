// DESIGN ONE FORM — its add / edit form, or its list. Move and resize fields,
// add new ones, change labels, rules, fonts and colours.
//
// Edits are kept as a DRAFT automatically; nobody sees them until Publish,
// which also changes the table to match: a new field adds a column; removing
// one asks first, because its column and every value in it would be deleted.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FactoryBuilder } from '@xeplr/ui-factory'
import { factory } from '../api/factory.js'

const PARTS = [
  { part: 'form', suffix: '_edit', label: 'Form' },
  { part: 'list', suffix: '_list', label: 'List' }
]

export default function FormDesigner() {
  const { form, part } = useParams()
  const navigate = useNavigate()
  const screenKey = form + (part === 'list' ? '_list' : '_edit')
  const [current, setCurrent] = useState(null)      // { key, document, lockedNames }
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setCurrent(null)
    // The draft if there is one, else the published version — with the field
    // names that are already columns, which cannot be renamed.
    factory.loadDraft(screenKey).then(
      (row) => { if (!cancelled) { setCurrent({ key: screenKey, document: row.document, lockedNames: row.lockedNames || [] }); setError(null) } },
      (e) => { if (!cancelled) setError(e.message) }
    )
    return () => { cancelled = true }
  }, [screenKey])

  const publish = useCallback(async (doc, options) => {
    const result = await factory.publish(doc, options)
    const row = await factory.loadDraft(doc.id)
    setCurrent((c) => (c && c.key === doc.id ? { ...c, lockedNames: row.lockedNames || [] } : c))
    return result
  }, [])

  return (
    <div className="app-designer">
      <div className="app-designer-bar">
        <button type="button" className="app-btn app-btn-quiet" onClick={() => navigate('/configure')}>← Configure UI</button>
        <span className="app-designer-title">{current ? current.document.name : form}</span>
        {PARTS.map((p) => (
          <button
            key={p.part}
            type="button"
            className={'app-btn app-btn-quiet' + ((part === 'list') === (p.part === 'list') ? ' is-active' : '')}
            onClick={() => navigate('/configure/forms/' + form + '/design/' + p.part)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {error && <div className="app-error">{error}</div>}
      {current && (
        <div className="app-designer-canvas">
          <FactoryBuilder
            key={current.key}
            {...factory.builderProps}
            document={current.document}
            lockedNames={current.lockedNames}
            onPublish={publish}
            screens={PARTS.map((p) => ({ id: form + p.suffix, name: p.label }))}
          />
        </div>
      )}
    </div>
  )
}
