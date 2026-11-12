// A FLOW, being walked through — /journey/<key>, and /journey/<key>/<run> once
// it has started. The run id in the address is what lets a journey be
// reloaded, left, or handed to someone else and opened on the step it is on.
//
// This page holds no route through the journey: Workflow says which screen
// comes next, from what was filled in.
import { useNavigate, useParams } from 'react-router-dom'
import { FlowRunner } from '@xeplr/ui-factory'
import { flows } from '../api/flows.js'
import { factory } from '../api/factory.js'

export default function Journey() {
  const { flow, run } = useParams()
  const navigate = useNavigate()
  return (
    <div className="app-page">
      <FlowRunner
        {...flows.runnerProps}
        {...factory.screenProps}
        flowKey={flow}
        runId={run}
        onStep={(step) => { if (step.runId && step.runId !== run) navigate(`/journey/${flow}/${step.runId}`, { replace: true }) }}
        renderDone={() => (
          <div className="app-help">
            <h2>All done</h2>
            <p>Everything in this journey is filled in.</p>
            <button type="button" className="app-btn" onClick={() => navigate(`/journey/${flow}`)}>Start another</button>
          </div>
        )}
      />
    </div>
  )
}
