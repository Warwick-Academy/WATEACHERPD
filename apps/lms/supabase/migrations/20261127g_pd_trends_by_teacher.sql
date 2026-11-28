-- =====================================================================
-- WATEACHERPD — PD module fix 6: per-teacher criteria trends for reports
-- Run AFTER 20261127f_pd_training_evidence_fix.sql. Safe to re-run.
-- Adds pd_v_criteria_ratings_by_teacher: appraisal rating counts per
-- teacher, per criterion, per year, with the teacher's department and
-- phase so reports can filter, then sum for charts and CSV.
-- security_invoker = true: each viewer only gets rows their RLS allows
-- (admin/leadership: all published appraisals; Feedback Leaders: their
-- team; staff: their own). Drafts are never included.
-- pd_v_criteria_trends (school-wide totals) is unchanged.
-- =====================================================================

DROP VIEW IF EXISTS pd_v_criteria_ratings_by_teacher;
CREATE VIEW pd_v_criteria_ratings_by_teacher WITH (security_invoker = true) AS
SELECT
  o.year_id,
  o.teacher_id,
  p.name        AS teacher_name,
  p.department,
  p.phase,
  cat.id        AS category_id,
  cat.name      AS category,
  cat.sort_order AS category_order,
  cr.id         AS criterion_id,
  cr.label      AS criterion,
  cr.sort_order AS criterion_order,
  COUNT(*) FILTER (WHERE r.rating = 'always_mostly') AS always_mostly,
  COUNT(*) FILTER (WHERE r.rating = 'sometimes')     AS sometimes,
  COUNT(*) FILTER (WHERE r.rating = 'no')            AS no,
  COUNT(*) FILTER (WHERE r.rating = 'na')            AS na,
  COUNT(*)                                            AS total
FROM pd_observation_ratings r
JOIN pd_observations o  ON o.id = r.observation_id
                       AND o.form_type = 'appraisal'
                       AND o.status <> 'draft'
JOIN profiles p         ON p.id = o.teacher_id
JOIN pd_obs_criteria cr ON cr.id = r.criterion_id
JOIN pd_obs_categories cat ON cat.id = cr.category_id
GROUP BY o.year_id, o.teacher_id, p.name, p.department, p.phase,
         cat.id, cat.name, cat.sort_order, cr.id, cr.label, cr.sort_order;

GRANT SELECT ON pd_v_criteria_ratings_by_teacher TO authenticated;

-- Done.
