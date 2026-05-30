import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function CommandPlaceholder() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('shell.search.open')}
        className="flex h-8 items-center gap-2 rounded border border-hairline px-2.5 u-caption text-text-3 hover:bg-tile"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">{t('shell.search.placeholder')}</span>
        <span className="ml-2 hidden rounded bg-tile px-1 py-0.5 u-caption text-text-4 sm:inline">
          ⌘K
        </span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-32"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[32rem] max-w-[90vw] rounded-md border border-hairline bg-popover p-4 shadow-[var(--shadow-dialog)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="u-body text-text-2">{t('shell.search.comingSoon')}</p>
          </div>
        </div>
      )}
    </>
  )
}
