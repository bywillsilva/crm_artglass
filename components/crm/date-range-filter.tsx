'use client'

import { CalendarRange, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createDefaultDateFilter,
  getDateRangeFromPreset,
  normalizeDateFilter,
  type DateFilterPreset,
  type DateFilterValue,
} from '@/lib/utils/date-filter'

const presetLabels: Record<DateFilterPreset, string> = {
  current_month: 'Mes atual',
  last_30_days: '30 dias',
  last_90_days: '90 dias',
  current_year: 'Ano atual',
  custom: 'Personalizado',
}

interface DateRangeFilterProps {
  value: DateFilterValue
  onChange: (value: DateFilterValue) => void
}

function formatCompactDate(value: string) {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) {
    return value
  }

  return `${day}/${month}/${year}`
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const safeValue = normalizeDateFilter(value.startDate && value.endDate ? value : createDefaultDateFilter())
  const rangeLabel = `${formatCompactDate(safeValue.startDate)} - ${formatCompactDate(safeValue.endDate)}`

  const handlePresetChange = (preset: DateFilterPreset) => {
    onChange(getDateRangeFromPreset(preset))
  }

  const handleDateChange = (field: 'startDate' | 'endDate', nextValue: string) => {
    onChange(
      normalizeDateFilter({
        ...safeValue,
        preset: 'custom',
        [field]: nextValue,
      })
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 max-w-full justify-start gap-3 rounded-full border-border/70 bg-card/70 px-3 text-left shadow-sm backdrop-blur-sm hover:bg-card"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarRange className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Periodo
            </span>
            <span className="block truncate text-sm font-medium text-foreground">
              {presetLabels[safeValue.preset]} · {rangeLabel}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(92vw,360px)] space-y-4 rounded-2xl border-border/70 bg-card/95 p-4 shadow-xl backdrop-blur-sm"
      >
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Periodo analisado
          </p>
          <p className="text-sm text-foreground">
            Ajuste rapidamente o intervalo usado nos indicadores e graficos.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Preferencia
          </Label>
          <Select value={safeValue.preset} onValueChange={(next) => handlePresetChange(next as DateFilterPreset)}>
            <SelectTrigger className="h-9 rounded-xl bg-background/70">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(presetLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Inicio
            </Label>
            <Input
              type="date"
              className="h-9 rounded-xl bg-background/70"
              value={safeValue.startDate}
              onChange={(event) => handleDateChange('startDate', event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Fim
            </Label>
            <Input
              type="date"
              className="h-9 rounded-xl bg-background/70"
              value={safeValue.endDate}
              onChange={(event) => handleDateChange('endDate', event.target.value)}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
