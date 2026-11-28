export type PdUserType = "user" | "admin" | "instructor" | "leadership"
export type PdPhase = "primary" | "secondary" | "both"
export type PdGoalStatus = "not_started" | "on_track" | "needs_support" | "complete"
export type PdObservationFormType =
  | "learning_walk"
  | "fl_learning_walk"
  | "appraisal"
  | "self_reflection"
export type PdObservationStatus = "draft" | "published" | "signed"
export type PdOverallRating = "exceeding" | "meeting" | "almost_meeting" | "not_meeting"
export type PdCriterionRating = "always_mostly" | "sometimes" | "no" | "na"
export type PdCpdSource = "manual" | "admin" | "course"
export type PdCpdActivityType =
  | "platform_course"
  | "workshop_inset"
  | "microsoft_learn"
  | "external_course"
  | "conference"
  | "peer_observation"
  | "reading_research"
  | "other"

export interface PdProfile {
  id: string
  name: string
  email: string
  user_type: PdUserType
  job_title: string | null
  department: string | null
  phase: PdPhase
  is_active: boolean
  pd_email_reminders: boolean
  profile_image?: string | null
  created_at?: string
}

export interface PdAcademicYear {
  id: number
  name: string
  start_date: string
  end_date: string
  is_current: boolean
}

export interface PdSettings {
  id: 1
  annual_cpd_target_hours: number
  max_goals_per_year: number
  updated_at: string | null
}

export interface PdFeedbackAssignment {
  id: number
  year_id: number
  staff_id: string
  leader_id: string
  is_lead: boolean
  created_at: string | null
}

export interface PdSchoolGoal {
  id: number
  year_id: number
  title: string
  description: string | null
  sort_order: number
  is_active: boolean
  created_at: string | null
}

export interface PdGoal {
  id: string
  user_id: string
  year_id: number
  title: string
  smart_description: string
  action_plan: string | null
  support_required: string | null
  target_date: string | null
  school_goal_id: number | null
  status: PdGoalStatus
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface PdGoalUpdate {
  id: string
  goal_id: string
  author_id: string
  note: string
  status: PdGoalStatus | null
  is_checkin: boolean
  created_at: string
}

export interface PdObservationCategory {
  id: number
  name: string
  sort_order: number
  guidance: string | null
  student_questions: string[]
  is_active: boolean
}

export interface PdObservationCriterion {
  id: number
  category_id: number
  label: string
  sort_order: number
  secondary_only: boolean
  is_active: boolean
}

export interface PdObservation {
  id: string
  year_id: number | null
  form_type: PdObservationFormType
  teacher_id: string
  observer_id: string
  observation_date: string
  year_group: string | null
  subject: string | null
  comment: string | null
  overall_comment: string | null
  overall_rating: PdOverallRating | null
  goal_id: string | null
  status: PdObservationStatus
  published_at: string | null
  teacher_response: string | null
  teacher_acknowledged_at: string | null
  observer_signed_at: string | null
  teacher_signed_at: string | null
  created_at: string
  updated_at: string
}

export interface PdObservationSection {
  observation_id: string
  category_id: number
  evidence_comment: string | null
  reflection_questions: string | null
  teacher_response: string | null
}

export interface PdObservationRating {
  observation_id: string
  criterion_id: number
  rating: PdCriterionRating
}

export interface PdCpdActivity {
  id: string
  user_id: string
  year_id: number | null
  title: string
  description: string | null
  activity_type: PdCpdActivityType
  provider: string | null
  activity_date: string
  hours: number
  impact_reflection: string | null
  evidence_path: string | null
  evidence_name: string | null
  goal_id: string | null
  source: PdCpdSource
  course_id: number | null
  batch_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PdStaffYearSummary {
  user_id: string
  name: string
  email: string
  department: string | null
  job_title: string | null
  phase: PdPhase
  year_id: number
  year_name: string
  goals_total: number
  goals_complete: number
  goals_needs_support: number
  cpd_hours: number
  training_hours: number
  learning_walks: number
  fl_learning_walks: number
  appraisal_rating: PdOverallRating | null
  appraisal_status: PdObservationStatus | null
}

export interface PdCriteriaTrend {
  year_id: number
  category: string
  criterion_id: number
  criterion: string
  sort_order: number
  criterion_order: number
  always_mostly: number
  sometimes: number
  no: number
  na: number
}

export interface PdCriteriaRatingByTeacher extends Omit<PdCriteriaTrend, "sort_order"> {
  teacher_id: string
  teacher_name: string
  department: string | null
  phase: PdPhase
  category_id: number
  category_order: number
  total: number
}
