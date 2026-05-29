// apps/web/src/lib/use-locale-format.ts
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'

export function useLocaleFormat() {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const dateTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  )
  const numberFmt = useMemo(() => new Intl.NumberFormat(locale), [locale])
  return {
    dateTime: (d: Date) => dateTimeFmt.format(d),
    number: (n: number) => numberFmt.format(n),
  }
}
