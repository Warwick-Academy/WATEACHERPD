"use client"

import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function PdReminderSettings({ userId }: { userId?: string }) {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const preference = useQuery({
    queryKey: ["pd", "reminder-preference", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) throw new Error(error?.message ?? "Please sign in again.")
      if (user.id !== userId) throw new Error("Your session changed. Please reload your profile.")
      const result = await supabase.from("profiles").select("pd_email_reminders").eq("id", user.id).single<{ pd_email_reminders: boolean }>()
      if (result.error) throw new Error(result.error.message)
      return { userId: user.id, enabled: result.data.pd_email_reminders }
    },
  })
  const update = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!preference.data) throw new Error("Please reload your profile.")
      const { error } = await supabase.from("profiles").update({ pd_email_reminders: enabled }).eq("id", preference.data.userId).select("id").single()
      if (error) throw new Error(error.message)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pd", "reminder-preference", userId] }),
  })
  return <Card>
    <CardHeader><CardTitle>PD email reminders</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="pd-email-reminders">Goal and observation reminders</Label>
        <Switch id="pd-email-reminders" checked={preference.data?.enabled ?? false} disabled={!preference.data || update.isPending} onCheckedChange={(enabled) => update.mutate(enabled)} />
      </div>
      <p className="text-sm text-muted-foreground">Turning reminders off does not turn off essential observation and appraisal emails.</p>
      {(preference.error || update.error) && <p role="alert" className="text-sm text-destructive">{(preference.error || update.error)?.message}</p>}
    </CardContent>
  </Card>
}
