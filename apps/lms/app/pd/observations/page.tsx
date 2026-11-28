"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { useObservationContext } from "@/lib/pd/observation-context"
import { observationNames, observationPermissions } from "@/lib/pd/observation-ui"
import type { PdObservation } from "@/lib/pd/types"

export default function ObservationsPage() {
  const { supabase, context } = useObservationContext()
  const [tab, setTab] = useState<"about" | "written" | "team">("about")
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "written") setTab("written")
  }, [])
  const records = useQuery({
    queryKey: ["pd", "observations", context.data?.viewer.id],
    enabled: !!context.data,
    refetchOnMount: true,
    queryFn: async () => {
      const { data, error } = await supabase.from("pd_observations").select("*").order("observation_date", { ascending: false }).returns<PdObservation[]>()
      if (error) throw new Error(error.message)
      return data
    },
  })
  const viewer = context.data?.viewer
  const filtered = (records.data ?? []).filter((item) => {
    if (!viewer || !context.data) return false
    if (tab === "about") return item.teacher_id === viewer.id && item.observer_id !== viewer.id
    if (tab === "written") return item.observer_id === viewer.id
    return item.teacher_id !== viewer.id && context.data.ledStaffIds.includes(item.teacher_id) && item.status !== "draft" && item.year_id === context.data.year.id
  }).sort((a, b) => Number(b.status === "draft") - Number(a.status === "draft"))
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Observations</h1><p className="text-sm text-muted-foreground">Learning Walks, appraisals and self-reflections</p></div>
      <Button asChild><Link href="/pd/observations/new">Start an observation</Link></Button>
    </div>
    {(context.error || records.error) && <p role="alert" className="text-destructive">{(context.error || records.error)?.message}</p>}
    {(context.isPending || (records.isPending && !!context.data)) && <p>Loading observations...</p>}
    <div className="flex flex-wrap gap-2" aria-label="Observation lists">
      <Button variant={tab === "about" ? "default" : "outline"} onClick={() => setTab("about")}>About me</Button>
      <Button variant={tab === "written" ? "default" : "outline"} onClick={() => setTab("written")}>Written by me</Button>
      {!!context.data?.ledStaffIds.length && <Button variant={tab === "team" ? "default" : "outline"} onClick={() => setTab("team")}>My team</Button>}
    </div>
    {records.data && filtered.length === 0 && <p className="text-muted-foreground">No observations in this list.</p>}
    {filtered.map((item) => {
      const otherId = tab === "about" ? item.observer_id : item.teacher_id
      const person = context.data?.people.find((p) => p.id === otherId)
      const permissions = observationPermissions(item, viewer!.id, viewer!.user_type)
      return <Card key={item.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="space-y-1">
          <Link className="font-semibold underline" href={`/pd/observations/${item.id}`}>{observationNames[item.form_type]}</Link>
          <p className="text-sm text-muted-foreground">{item.observation_date} · {otherId === viewer!.id ? "Self" : person?.name ?? "Staff member"}</p>
        </div>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{item.status}</Badge>
          {permissions.canRespond && !item.teacher_acknowledged_at && <Badge>Needs your response</Badge>}
          {permissions.canSign && <Badge variant="secondary">Waiting to be signed</Badge>}
        </div>
      </CardContent></Card>
    })}
  </div>
}
