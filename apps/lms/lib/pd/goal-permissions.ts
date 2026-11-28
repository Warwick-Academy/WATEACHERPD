import type { PdUserType } from "./types"

export function getGoalPermissions({
  role,
  isCurrentYear,
  isOwner,
  isLeader,
}: {
  role: PdUserType
  isCurrentYear: boolean
  isOwner: boolean
  isLeader: boolean
}) {
  if (role === "admin") return { canEdit: true, canUpdate: true }
  if (!isCurrentYear) return { canEdit: false, canUpdate: false }
  if (role === "leadership") return { canEdit: isOwner, canUpdate: isOwner }
  return { canEdit: isOwner, canUpdate: isOwner || isLeader }
}
