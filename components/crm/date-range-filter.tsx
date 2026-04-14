'use client'

import { CalendarRange } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  last_30_days: 'Ultimos 30 dias',
  last_90_days: 'Ultimos 90 dias',
  current_year: 'Ano atual',
  custom: 'Personalizado',
}

interface DateRangeFilterProps {
  value: DateFilterValue
  onChange: (value: DateFilterValue) => void
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const safeValue = normalizeDateFilter(value.startDate && value.endDate ? value : createDefaultDateFilter())

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
    <Card className="border-border bg-card">
      <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-end">
        <div className="flex items-center gap-3 md:min-w-[220px]">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <CalendarRange className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Periodo analisado</p>
            <p className="text-xs text-muted-foreground">
              Defina o intervalo usado nos indicadores e graficos
            </p>
          </div>
        </div>

        <div className="grid flex-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Preferencia</Label>
            <Select value={safeValue.preset} onValueChange={(value) => handlePresetChange(value as DateFilterPreset)}>
              <SelectTrigger>
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

          <div className="space-y-2">
            <Label>Data inicial</Label>
            <Input
              type="date"
              value={safeValue.startDate}
              onChange={(event) => handleDateChange('startDate', event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Data final</Label>
            <Input
              type="date"
              value={safeValue.endDate}
              onChange={(event) => handleDateChange('endDate', event.target.value)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
