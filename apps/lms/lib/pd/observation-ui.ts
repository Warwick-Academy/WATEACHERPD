import type { PdObservation, PdObservationFormType, PdUserType } from "./types"

export const observationNames: Record<PdObservationFormType, string> = {
  learning_walk: "Learning Walk (Informal)",
  fl_learning_walk: "Learning Walk (Feedback Leader)",
  appraisal: "Appraisal (End of Year)",
  self_reflection: "Self-reflection",
}

export function availableObservationForms(viewerId: string, teacherId: string, role: PdUserType, ledStaffIds: string[]): PdObservationFormType[] {
  if (!teacherId) return []
  if (teacherId === viewerId) return ["self_reflection"]
  const forms: PdObservationFormType[] = ["learning_walk"]
  if (role === "admin" || ledStaffIds.includes(teacherId)) forms.push("fl_learning_walk", "appraisal")
  return forms
}

export function observationPermissions(observation: PdObservation, viewerId: string, role: PdUserType) {
  const isWriter = observation.observer_id === viewerId
  const isTeacher = observation.teacher_id === viewerId
  return {
    canEdit: isWriter && observation.status === "draft",
    canDelete: isWriter && observation.status === "draft",
    canReopen: role === "admin" && observation.status !== "draft",
    canRespond: isTeacher && observation.form_type !== "self_reflection" && observation.status === "published" &&
      !(observation.form_type === "appraisal" && observation.teacher_signed_at),
    canAcknowledge: isTeacher && observation.form_type !== "self_reflection" && observation.status !== "draft" && !observation.teacher_acknowledged_at,
    canSign: observation.form_type === "appraisal" && observation.status === "published" &&
      ((isTeacher && !observation.teacher_signed_at) || (isWriter && !observation.observer_signed_at)),
  }
}
