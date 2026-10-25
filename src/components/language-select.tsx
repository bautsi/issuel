import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Switch the app language from a compact globe menu without remounting the workspace. */
export function LanguageSelect() {
  const { t, i18n } = useTranslation()
  return (
    <Select
      value={i18n.resolvedLanguage}
      onValueChange={(language) => void i18n.changeLanguage(language)}
    >
      <SelectTrigger
        aria-label={t('Language')}
        className="size-8 justify-center gap-0 border-transparent bg-transparent p-0 shadow-none [&>span:last-child]:hidden"
      >
        <svg
          aria-hidden="true"
          className="size-4 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z" />
        </svg>
        <span className="sr-only">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="zh-TW">繁體中文</SelectItem>
      </SelectContent>
    </Select>
  )
}
