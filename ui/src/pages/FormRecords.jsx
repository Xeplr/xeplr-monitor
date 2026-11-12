// USE ANY FORM — its published list, with New / Edit opening the form in a
// popup. Tasks.jsx is the same thing for one form, with a help panel beside it.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FactoryScreen } from '@xeplr/ui-factory'
import { factory } from '../api/factory.js'

export default function FormRecords() {
  const { form } = useParams()
  const [screen, setScreen] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setScreen(null)
    factory.loadScreen(form + '_list').then((doc) => { setScreen(doc); setError(null) }, (e) => setError(e.message))
  }, [form])

  return (
    <div className="app-page">
      {error && <div className="app-error">Could not open this form — {error}</div>}
      {screen && <FactoryScreen key={form} document={screen} {...factory.screenProps} />}
    </div>
  )
}
