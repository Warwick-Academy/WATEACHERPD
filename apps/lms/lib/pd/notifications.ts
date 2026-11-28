import type { SupabaseClient } from "@supabase/supabase-js"
import { emailService } from "../email/email-service"

export type NoticeType = "observation_published" | "appraisal_ready_to_sign" | "appraisal_signed" | "teacher_responded" | "teacher_acknowledged"
export type ReminderType = "goal_due" | "observation_unacknowledged"
type Notice = { outbox_id: number; event_type: NoticeType; observation_id: string; recipient_email: string | null }
type Reminder = { reminder_type: ReminderType; subject_id: string }
type ReminderClaim = { log_id: number; recipient_email: string | null }

const notices: Record<NoticeType | ReminderType, { subject: string; message: string }> = {
  observation_published: { subject: "A new observation is available", message: "An observation about you has been published." },
  appraisal_ready_to_sign: { subject: "An appraisal is ready to sign", message: "An appraisal is ready for your signature." },
  appraisal_signed: { subject: "Your appraisal has been signed", message: "Both parties have signed the appraisal." },
  teacher_responded: { subject: "A teacher has responded", message: "A teacher has responded to your observation." },
  teacher_acknowledged: { subject: "An observation was acknowledged", message: "A teacher has acknowledged your observation." },
  goal_due: { subject: "A PD goal target date is approaching", message: "A PD goal target date is within the next 14 days." },
  observation_unacknowledged: { subject: "An observation needs your attention", message: "An observation has been waiting for your acknowledgement for at least 7 days." },
}

export function notificationConfig() {
  const { SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, NEXT_PUBLIC_APP_URL } = process.env
  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL || !NEXT_PUBLIC_APP_URL) {
    throw new Error("PD email requires SENDGRID_API_KEY, SENDGRID_FROM_EMAIL and NEXT_PUBLIC_APP_URL.")
  }
  const url = new URL(NEXT_PUBLIC_APP_URL)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS, except for localhost.")
  }
  return url.origin
}

async function deliver(type: NoticeType | ReminderType, id: string, email: string | null, origin: string) {
  if (!notices[type] || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid PD notification event.")
  }
  if (!email) return { outcome: "failed" as const, error: "recipient email missing" }
  const path = type === "goal_due" ? "/pd/goals" : `/pd/observations/${id}`
  const result = await emailService.sendEmail({
    to: email, template: "pdNotice", data: { ...notices[type], url: new URL(path, origin).toString() },
  })
  if (result.success) return { outcome: "sent" as const, messageId: result.messageId }
  return { outcome: result.failureKind === "definite" ? "failed" as const : "uncertain" as const, error: "sendgrid delivery failed" }
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data as T
}

async function sendNotice(client: SupabaseClient, notice: Notice, origin: string, token?: string) {
  const result = await deliver(notice.event_type, notice.observation_id, notice.recipient_email, origin)
  await rpc(client, token ? "pd_complete_my_notification" : "pd_complete_notification", {
    ...(token ? { p_dispatch_token: token } : {}),
    p_id: notice.outbox_id,
    p_outcome: result.outcome,
    p_message_id: "messageId" in result ? result.messageId ?? null : null,
    p_error: "error" in result ? result.error : null,
  })
  if (result.outcome !== "sent") console.error(`PD notification ${notice.outbox_id}: ${result.outcome}`)
  return result.outcome
}

export async function dispatchMyNotifications(client: SupabaseClient, token: string, now = Date.now) {
  const origin = notificationConfig()
  const start = now()
  let sent = 0
  let failures = 0
  while (now() - start < 10000) {
    const claimed = await rpc<Notice[]>(client, "pd_claim_my_notifications", { p_dispatch_token: token })
    if (!claimed.length) return { sent, failures }
    if (claimed.length !== 1) throw new Error("Immediate notification claim must return at most one notice.")
    if (await sendNotice(client, claimed[0], origin, token) === "sent") sent++
    else failures++
  }
  console.warn("PD immediate notification dispatch reached its time budget; remaining notices will be considered by the scheduled job.")
  return { sent, failures }
}

export async function runScheduledNotifications(client: SupabaseClient, now = Date.now) {
  const origin = notificationConfig()
  const start = now()
  await rpc(client, "pd_mark_stale_notifications")
  await rpc(client, "pd_mark_stale_reminders")

  let noticeCount = 0
  while (now() - start < 10000) {
    const claimed = await rpc<Notice[]>(client, "pd_claim_pending_notifications", { p_limit: 1 })
    if (!claimed.length) break
    await sendNotice(client, claimed[0], origin)
    noticeCount++
  }
  if (now() - start >= 10000) console.warn("PD notification recovery reached its time budget; remaining notices will be considered on the next run.")

  const reminders = await rpc<Reminder[]>(client, "pd_list_due_reminders")
  let reminderCount = 0
  for (const reminder of reminders) {
    if (now() - start >= 20000) {
      console.warn("PD reminder run reached its time budget; remaining reminders will be considered on the next run.")
      break
    }
    const claims = await rpc<ReminderClaim[]>(client, "pd_claim_reminder", {
      p_type: reminder.reminder_type, p_subject_id: reminder.subject_id,
    })
    if (!claims.length) continue
    const claim = claims[0]
    const result = await deliver(reminder.reminder_type, reminder.subject_id, claim.recipient_email, origin)
    await rpc(client, "pd_complete_reminder", {
      p_log_id: claim.log_id, p_outcome: result.outcome,
      p_message_id: "messageId" in result ? result.messageId ?? null : null,
      p_error: "error" in result ? result.error : null,
    })
    if (result.outcome !== "sent") console.error(`PD reminder ${claim.log_id}: ${result.outcome}`)
    reminderCount++
  }
  return { notices: noticeCount, reminders: reminderCount }
}
