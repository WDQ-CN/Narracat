import { AudioLines } from 'lucide-react'
import { READING_BODY_FONT_CLASS } from '@/design-system'
import { parseNarratorVoiceSummary } from '@shared/lib/narrator-voice'

export function NarratorVoiceSummary({ content }: { content?: string }) {
  const summary = parseNarratorVoiceSummary(content ?? '')
  if (!summary) return null

  const rows = [
    ['腔调原型', summary.archetype],
    ['节奏', summary.pacing],
    ['修辞密度', summary.ornamentation],
    ['旁白距离', summary.address],
    ['插叙/议论', summary.digression],
    ['基调', summary.tone],
    ['关键词', summary.styleKeywords],
    ['参考来源', summary.referenceInspiration],
  ].filter((row): row is [string, string] => Boolean(row[1]))

  return (
    <section className="mb-6 border-b border-border pb-6" data-narrator-voice-summary="true">
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        <AudioLines className="size-3.5 shrink-0" />
        <span>来自全局大纲</span>
      </div>
      <h2 className="mt-2 text-lg font-semibold leading-tight text-foreground">叙事声音 / 写作风格</h2>
      {/* 字段之间靠留白分组，不用分隔线：label 的字号/字色已经承担了层级（design.md 9.x 降噪） */}
      <dl className="mt-5 space-y-5" data-narrator-voice-fields="true">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`mt-1.5 ${READING_BODY_FONT_CLASS} font-medium leading-7 text-foreground`}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
