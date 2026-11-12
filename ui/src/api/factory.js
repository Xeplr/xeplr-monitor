// MODEL LAYER — every call the screens and Configure UI make, to the API's
// @xeplr/factory routes (mounted at /api in api/app.js).
//
// authFetch attaches the signed-in user's token (and the active company, when
// the app has tenancy) and returns the PARSED body. createFactoryApi accepts
// it as it is. authFetchFile is the same request returning the file's bytes:
// how a form's stored pictures show as thumbnails.
import { authFetch, authFetchFile } from '@xeplr/ui-account'
import { createFactoryApi } from '@xeplr/ui-factory'

export const factory = createFactoryApi({ fetch: authFetch, fetchFile: authFetchFile, base: '/api' })
