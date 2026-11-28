import { z } from "zod"

export const staffProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  job_title: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  phase: z.enum(["primary", "secondary", "both"]),
  user_type: z.enum(["user", "admin", "instructor", "leadership"]),
  is_active: z.boolean(),
  pd_email_reminders: z.boolean().optional(),
})

export const schoolGoalSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(180),
  description: z.string().trim().max(2000).optional().nullable(),
  is_active: z.boolean().default(true),
})

export const goalSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(180),
  smart_description: z.string().trim().min(1, "A SMART goal description is required").max(5000),
  action_plan: z.string().trim().max(5000).optional().nullable(),
  support_required: z.string().trim().max(5000).optional().nullable(),
  target_date: z.string().date("Enter a valid date").optional().nullable(),
  school_goal_id: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum(["not_started", "on_track", "needs_support", "complete"]).default("not_started"),
})

export const goalUpdateSchema = z.object({
  note: z.string().trim().min(1, "Progress is required").max(5000),
  status: z.enum(["not_started", "on_track", "needs_support", "complete"]).optional().nullable(),
  is_checkin: z.boolean().default(false),
})

export const observationCreateSchema = z.object({
  teacher_id: z.string().uuid(),
  form_type: z.enum(["learning_walk", "fl_learning_walk", "appraisal", "self_reflection"]),
  observation_date: z.string().date(),
  year_id: z.number().int().positive().optional().nullable(),
  year_group: z.string().trim().max(100).optional().nullable(),
  subject: z.string().trim().max(100).optional().nullable(),
  comment: z.string().trim().max(5000).optional().nullable(),
  overall_comment: z.string().trim().max(5000).optional().nullable(),
  overall_rating: z.enum(["exceeding", "meeting", "almost_meeting", "not_meeting"]).optional().nullable(),
})

export const observationSectionSchema = z.object({
  category_id: z.number().int().positive(),
  evidence_comment: z.string().trim().max(5000).optional().nullable(),
  reflection_questions: z.string().trim().max(5000).optional().nullable(),
  teacher_response: z.string().trim().max(5000).optional().nullable(),
})

export const observationResponseSchema = z.object({
  observation_id: z.string().uuid(),
  response: z.string().trim().max(5000).default(""),
  sections: z.array(z.object({
    category_id: z.number().int().positive(),
    teacher_response: z.string().trim().max(5000).optional().nullable(),
  })).default([]),
  goal_id: z.string().uuid().optional().nullable(),
})

export const observationRatingSchema = z.object({
  criterion_id: z.number().int().positive(),
  rating: z.enum(["always_mostly", "sometimes", "no", "na"]),
})

export const cpdActivitySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(180),
  description: z.string().trim().max(5000).optional().nullable(),
  activity_type: z.enum([
    "platform_course",
    "workshop_inset",
    "microsoft_learn",
    "external_course",
    "conference",
    "peer_observation",
    "reading_research",
    "other",
  ]),
  provider: z.string().trim().max(180).optional().nullable(),
  activity_date: z.string().date(),
  hours: z.coerce.number().positive().max(100),
  impact_reflection: z.string().trim().max(5000).optional().nullable(),
  evidence_path: z.string().trim().max(1000).optional().nullable(),
  evidence_name: z.string().trim().max(255).optional().nullable(),
  goal_id: z.string().uuid().optional().nullable(),
})

export const pdSettingsSchema = z.object({
  annual_cpd_target_hours: z.coerce.number().positive().max(99999),
  max_goals_per_year: z.coerce.number().int().min(1).max(10),
})

export const newAcademicYearSchema = z.object({
  name: z.string().trim().min(1).max(50),
  start_date: z.string().date(),
  end_date: z.string().date(),
  copy_assignments: z.boolean().default(true),
}).refine((value) => value.end_date > value.start_date, {
  message: "End date must be after start date",
  path: ["end_date"],
})

export const bulkCpdSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
  title: z.string().trim().min(1).max(180),
  activity_type: z.enum([
    "platform_course",
    "workshop_inset",
    "microsoft_learn",
    "external_course",
    "conference",
    "peer_observation",
    "reading_research",
    "other",
  ]),
  provider: z.string().trim().max(180).optional().nullable(),
  activity_date: z.string().date(),
  hours: z.coerce.number().positive().max(100),
  description: z.string().trim().max(5000).optional().nullable(),
})
