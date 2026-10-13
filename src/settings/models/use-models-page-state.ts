/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toCompilableQuery } from '@powersync/drizzle-driver'
import { useQuery } from '@powersync/tanstack-react-query'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useReducer } from 'react'

import { useDatabase } from '@/contexts'
import { deleteModel, getAllModels, resetModelToDefault, updateModel } from '@/dal'
import { useConfigStore } from '@/api/config-store'
import { pickModelsDefaults } from '@/lib/pick-defaults'
import type { EditModelSubmission } from './edit-model-form'
import { initialModelsPageState, modelsPageReducer, type ModelPanel } from './page-state'
import { useAddModelForm } from './use-add-model-form'

/** Owns Models page reducer, forms, catalog requests, tests, and DAL mutations. */
export const useModelsPageState = () => {
  const db = useDatabase()
  const [state, dispatch] = useReducer(modelsPageReducer, initialModelsPageState)
  const { panel, deleteConfirmId, mutationError } = state
  const isAddPanelOpen = panel?.kind === 'add'
  const activeModelId = panel?.kind === 'detail' || panel?.kind === 'edit' ? panel.modelId : null
  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    query: toCompilableQuery(getAllModels(db)),
  })
  const activeModel = models.find((model) => model.id === activeModelId)
  const editingModel = panel?.kind === 'edit' ? activeModel : undefined
  const clearMutationError = useCallback(() => dispatch({ type: 'MUTATION_STARTED' }), [])
  const closeAddPanel = useCallback(() => dispatch({ type: 'PANEL_CHANGED', panel: null }), [])
  const addForm = useAddModelForm({
    isOpen: isAddPanelOpen,
    onClose: closeAddPanel,
    onMutationStart: clearMutationError,
  })

  const failMutation = (message: string) => (error: unknown) => {
    console.error(message, error)
    dispatch({ type: 'MUTATION_FAILED', error: message })
  }
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateModel(db, id, { enabled: enabled ? 1 : 0 }),
    onMutate: clearMutationError,
    onError: failMutation('Failed to update the model.'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteModel(db, id),
    onMutate: clearMutationError,
    onSuccess: () => dispatch({ type: 'DELETE_DISMISSED' }),
    onError: failMutation('Failed to delete the model.'),
  })
  const editMutation = useMutation({
    mutationFn: async (values: EditModelSubmission) => {
      const { id, ...fields } = values
      await updateModel(db, id, { ...fields, url: fields.url || null })
    },
    onMutate: clearMutationError,
    onSuccess: (_result, values) => dispatch({ type: 'PANEL_CHANGED', panel: { kind: 'detail', modelId: values.id } }),
    onError: failMutation('Failed to save the model.'),
  })
  /**
   * The defaults a reset can restore to.
   *
   * Resolved through `pickModelsDefaults`, i.e. `max(bundle, OTA)` — the same pick
   * `use-app-initialization` feeds to reconcile, so "reset" restores the row to the
   * value reconcile would write. Reading the bundled array directly was wrong on this
   * fork, which ships `defaultModels` EMPTY (system models arrive from the backend):
   * the lookup could never match, and every reset took the fallback branch below.
   */
  const restorableDefaults = pickModelsDefaults(useConfigStore((store) => store.config.defaults?.models)).data
  const defaultFor = (id: string) => restorableDefaults.find((candidate) => candidate.id === id)

  const resetMutation = useMutation({
    mutationFn: async (id: string) => {
      const defaultModel = defaultFor(id)
      if (!defaultModel) {
        // Nothing to restore to. The row still carries a `defaultHash` — that is what
        // offers Reset at all — but its default is no longer shipped. Upstream deleted
        // the row here; that soft-deletes the model and HARD-deletes its stored API key,
        // its profile and its prompts, which is not something an action labelled "reset"
        // may do. Retiring a default is reconcile's job (`cleanupRemovedDefaults`), not
        // this button's. `canResetModel` keeps the affordance hidden in this state, so
        // reaching here means the row changed under an open panel.
        return
      }
      await resetModelToDefault(db, id, defaultModel)
    },
    onMutate: clearMutationError,
    onError: failMutation('Failed to reset the model.'),
  })

  const openAddPanel = () => {
    dispatch({ type: 'PANEL_CHANGED', panel: { kind: 'add' } })
    addForm.prepareForOpen()
  }
  const changePanel = (nextPanel: ModelPanel) => {
    if (isAddPanelOpen) {
      // Reset every add-form resource (draft fields, selected model,
      // connection probe, and catalog) before another panel replaces it.
      addForm.resetForm()
    }
    dispatch({ type: 'PANEL_CHANGED', panel: nextPanel })
  }
  const closePanel = () => {
    if (isAddPanelOpen) {
      addForm.onCancel()
      return
    }
    dispatch({
      type: 'PANEL_CHANGED',
      panel: panel?.kind === 'edit' ? { kind: 'detail', modelId: panel.modelId } : null,
    })
  }

  return {
    panel,
    deleteConfirmId,
    models,
    activeModelId,
    activeModel,
    editingModel,
    isAddPanelOpen,
    mutationError,
    addForm,
    openAddPanel,
    closePanel,
    selectActiveModel: (modelId: string) => changePanel(activeModelId === modelId ? null : { kind: 'detail', modelId }),
    toggleModel: (id: string, enabled: boolean) => toggleMutation.mutate({ id, enabled }),
    openEditPanel: (modelId: string) => changePanel({ kind: 'edit', modelId }),
    closeEditPanel: (modelId: string) => dispatch({ type: 'PANEL_CHANGED', panel: { kind: 'detail', modelId } }),
    submitEdit: (values: EditModelSubmission) => editMutation.mutate(values),
    isEditPending: editMutation.isPending,
    /** Whether a reset can actually restore this row — false once its default stops shipping. */
    canResetModel: (modelId: string) => defaultFor(modelId) !== undefined,
    requestDelete: (modelId: string | null) =>
      modelId ? dispatch({ type: 'DELETE_REQUESTED', modelId }) : dispatch({ type: 'DELETE_DISMISSED' }),
    confirmDelete: () => {
      if (deleteConfirmId) {
        deleteMutation.mutate(deleteConfirmId)
      }
    },
    isDeletePending: deleteMutation.isPending,
    resetModel: (id: string) => resetMutation.mutate(id),
  }
}
