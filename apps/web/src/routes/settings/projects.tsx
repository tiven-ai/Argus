import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createProject, deleteProject, fetchProjects, renameProject } from '../../lib/api'
import { useLocaleFormat } from '../../lib/use-locale-format'
import { useProjectFilter } from '../../lib/use-project-filter'

export const Route = createFileRoute('/settings/projects')({
  component: ProjectsPage,
})

const inputClass =
  'h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1'

function isConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('409')
}

function ProjectsPage() {
  const { t } = useTranslation()
  const f = useLocaleFormat()
  const queryClient = useQueryClient()
  const { project: activeProject, setProject } = useProjectFilter()
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    retry: false,
  })

  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const create = useMutation({
    mutationFn: () => createProject({ name: newName }),
    onSuccess: () => {
      setNewName('')
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const rename = useMutation({
    mutationFn: (vars: { id: string; name: string }) => renameProject(vars.id, { name: vars.name }),
    onSuccess: () => {
      setEditingId(null)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: (_data, id) => {
      setDeletingId(null)
      setConfirmText('')
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (activeProject === id) setProject(null)
    },
  })

  if (isLoading) return <p className="p-6 u-body text-text-3">{t('common.loading')}</p>
  if (error)
    return <p className="p-6 u-body text-danger">{t('common.error', { message: String(error) })}</p>

  const projects = data?.projects ?? []
  const deleting = deletingId ? (projects.find((p) => p.id === deletingId) ?? null) : null

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <header>
        <h2 className="u-h-lg text-text-1">{t('projects.title')}</h2>
        <p className="u-body text-text-3 mt-1">{t('projects.intro')}</p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (newName) create.mutate()
        }}
        className="border border-hairline rounded p-3 space-y-3 max-w-xl"
      >
        <h3 className="u-h-md text-text-1">{t('projects.create.title')}</h3>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">{t('projects.create.name')}</span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('projects.create.placeholder')}
            required
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 px-4 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {create.isPending ? t('projects.create.submitting') : t('projects.create.submit')}
        </button>
        {create.error && (
          <p className="u-caption text-danger">
            {isConflict(create.error) ? t('projects.create.conflict') : String(create.error)}
          </p>
        )}
      </form>

      <section>
        <h3 className="u-h-md text-text-1 mb-2">{t('projects.existing.title')}</h3>
        {projects.length === 0 && (
          <p className="u-body text-text-3">{t('projects.existing.empty')}</p>
        )}
        {projects.length > 0 && (
          <div className="border border-hairline rounded">
            <table className="w-full u-body">
              <thead>
                <tr className="text-left u-caption text-text-3 border-b border-hairline">
                  <th className="font-normal px-3 py-2">{t('projects.existing.columns.name')}</th>
                  <th className="font-normal px-3 py-2">
                    {t('projects.existing.columns.created')}
                  </th>
                  <th className="px-3 py-2 text-right">{t('projects.existing.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 text-text-1">
                      {editingId === p.id ? (
                        <input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className={inputClass}
                          autoFocus
                        />
                      ) : (
                        p.name
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-3 tabular">
                      {f.dateTime(new Date(p.createdAt))}
                    </td>
                    <td className="px-3 py-2 text-right space-x-3">
                      {editingId === p.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              editingName && rename.mutate({ id: p.id, name: editingName })
                            }
                            disabled={rename.isPending}
                            className="u-caption text-brand hover:underline disabled:opacity-50"
                          >
                            {t('projects.rename.save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="u-caption text-text-3 hover:underline"
                          >
                            {t('projects.rename.cancel')}
                          </button>
                          {rename.error && editingId === p.id && (
                            <span className="u-caption text-danger">
                              {isConflict(rename.error)
                                ? t('projects.rename.conflict')
                                : String(rename.error)}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(p.id)
                              setEditingName(p.name)
                              rename.reset()
                            }}
                            className="u-caption text-text-3 hover:text-text-1 hover:underline"
                          >
                            {t('projects.rename.action')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingId(p.id)
                              setConfirmText('')
                            }}
                            className="u-caption text-danger hover:underline"
                          >
                            {t('projects.delete.action')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-32"
          onClick={() => setDeletingId(null)}
        >
          <div
            className="w-[32rem] max-w-[90vw] rounded-md border border-hairline bg-popover p-4 space-y-3 shadow-[var(--shadow-dialog)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="u-h-md text-danger">{t('projects.delete.title')}</h3>
            <p className="u-body text-text-2">
              {t('projects.delete.warning', { name: deleting.name })}
            </p>
            <label className="block space-y-1">
              <span className="u-caption text-text-3">
                {t('projects.delete.confirmLabel', { name: deleting.name })}
              </span>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className={inputClass}
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                className="h-8 px-4 rounded border border-hairline text-text-2 u-body hover:bg-tile"
              >
                {t('projects.delete.cancel')}
              </button>
              <button
                type="button"
                disabled={confirmText !== deleting.name || remove.isPending}
                onClick={() => remove.mutate(deleting.id)}
                className="h-8 px-4 rounded bg-danger text-white u-body hover:opacity-90 disabled:opacity-50"
              >
                {remove.isPending ? t('projects.delete.submitting') : t('projects.delete.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
