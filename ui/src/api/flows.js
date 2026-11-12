// Flows are at /api/workflow/flows — @xeplr/workflow-api, running inside this
// app's API. authFetch carries the same sign-in and company as every other call.
import { authFetch } from '@xeplr/ui-account'
import { createFlowsApi } from '@xeplr/ui-factory'

export const flows = createFlowsApi({ fetch: authFetch, base: '/api/workflow' })
