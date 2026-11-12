// ONE FLOW, DESIGNED — /configure/flows/<key>.
//
// @xeplr/ui-factory's designer: the flow's screens down the left; for the one
// picked, its Form design (the screen's own builder) and its Events &
// navigation — this app's functions (api/functions/) picked by name for each
// event, and where the journey goes once the screen is saved. The selected
// step and tab live in the address (?flowSelected=…&flowTab=…), so a reload or
// a shared link opens the same place.
//
// Everything it needs comes from the two API clients — the wiring lives in
// the package, so an upgrade reaches this app.
import { useNavigate, useParams } from 'react-router-dom'
import { FlowDesignerPage } from '@xeplr/ui-factory'
import { factory } from '../api/factory.js'
import { flows } from '../api/flows.js'

export default function FlowDesigner() {
  const { flow } = useParams()
  const navigate = useNavigate()
  return (
    <div className="app-designer">
      <div className="app-designer-bar">
        <button type="button" className="app-btn app-btn-quiet" onClick={() => navigate('/configure?tab=flows')}>← Flows</button>
      </div>
      <div className="app-designer-canvas">
        <FlowDesignerPage factory={factory} flows={flows} flowKey={flow} urlKey="flow" />
      </div>
    </div>
  )
}
