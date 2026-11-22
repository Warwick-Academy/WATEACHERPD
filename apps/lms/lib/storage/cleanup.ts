/**
 * Storage cleanup utilities.
 *
 * Deletes a course's, lesson's or resource's files from Supabase Storage when they
 * are deleted. URLs that are not in this project's Supabase Storage (site-relative
 * paths such as /courses/... and /brand/..., or external URLs) are always left alone.
 */
import { createServiceRoleClient } from "@/lib/supabase/server"
import { deleteFile } from "./server"
import { extractStoragePathFromUrl } from "./shared"
async function deleteStoredUrl(url: string | null | undefined): Promise<boolean> {
  if (!url) return false
  const location = extractStoragePathFromUrl(url)
  if (!location) return false
  await deleteFile(location.path, location.bucket)
  return true
}

/**
 * Cleanup storage files for a course:
 * thumbnail, preview video, lesson files and unused resource files.
 */
export async function cleanupCourseFiles(courseId: number): Promise<{ deleted: number; errors: number }> {
  const supabase = createServiceRoleClient()
  let deleted = 0
  let errors = 0

  try {
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("image, preview_video, created_by")
      .eq("id", courseId)
      .single()

    if (courseError) {
      console.error(`Error fetching course ${courseId} for cleanup:`, courseError)
      return { deleted: 0, errors: 1 }
    }

    for (const url of [course.image, course.preview_video]) {
      try {
        if (await deleteStoredUrl(url)) deleted++
      } catch (error) {
        console.error(`Error deleting course file ${url}:`, error)
        errors++
      }
    }

    const { data: lessons, error: lessonsError } = await supabase
      .from("lessons")
      .select("id, content")
      .eq("course_id", courseId)

    if (lessonsError) {
      console.error(`Error fetching lessons for course ${courseId}:`, lessonsError)
      return { deleted, errors: errors + 1 }
    }

    for (const lesson of lessons || []) {
      const lessonResult = await cleanupLessonFiles(lesson.id)
      deleted += lessonResult.deleted
      errors += lessonResult.errors
    }

    // Cleanup resource files created by the course creator that are no longer used anywhere
    const { data: resources, error: resourcesError } = await supabase
      .from("resources")
      .select("id, s3_key, url")
      .eq("created_by", course.created_by)
      .not("s3_key", "is", null)

    if (!resourcesError && resources) {
      const { data: lessonResources } = await supabase
        .from("lesson_resources")
        .select("resource_id")
        .in("lesson_id", (lessons || []).map(l => l.id))

      const usedResourceIds = new Set((lessonResources || []).map((lr: any) => lr.resource_id))

      for (const resource of resources) {
        if (usedResourceIds.has(resource.id)) continue

        const { data: otherUsage } = await supabase
          .from("lesson_resources")
          .select("id")
          .eq("resource_id", resource.id)
          .limit(1)

        if (otherUsage && otherUsage.length > 0) continue

        try {
          if (await deleteStoredUrl(resource.url)) deleted++
        } catch (error) {
          console.error(`Error deleting resource file ${resource.id}:`, error)
          errors++
        }
      }
    }

    console.log(`Course cleanup complete: ${deleted} files deleted, ${errors} errors`)
    return { deleted, errors }
  } catch (error) {
    console.error(`Error cleaning up course ${courseId}:`, error)
    return { deleted, errors: errors + 1 }
  }
}

/**
 * Cleanup storage files for a lesson: lesson video and unused resource files.
 */
export async function cleanupLessonFiles(lessonId: number): Promise<{ deleted: number; errors: number }> {
  const supabase = createServiceRoleClient()
  let deleted = 0
  let errors = 0

  try {
    const { data: lesson, error: lessonError } = await supabase
      .from("lessons")
      .select("id, content")
      .eq("id", lessonId)
      .single()

    if (lessonError || !lesson) {
      console.error(`Error fetching lesson ${lessonId} for cleanup:`, lessonError)
      return { deleted: 0, errors: 1 }
    }

    const content = lesson.content as any
    try {
      if (await deleteStoredUrl(content?.url)) deleted++
    } catch (error) {
      console.error(`Error deleting lesson video for lesson ${lessonId}:`, error)
      errors++
    }

    const { data: lessonResources } = await supabase
      .from("lesson_resources")
      .select("resource_id, resources(s3_key, url)")
      .eq("lesson_id", lessonId)

    for (const lr of lessonResources || []) {
      const resource = (lr as any).resources
      if (!resource) continue

      const { data: otherUsage } = await supabase
        .from("lesson_resources")
        .select("id")
        .eq("resource_id", (lr as any).resource_id)
        .neq("lesson_id", lessonId)
        .limit(1)

      if (otherUsage && otherUsage.length > 0) continue

      try {
        if (await deleteStoredUrl(resource.url)) {
          deleted++
        }
      } catch (error) {
        console.error(`Error deleting resource file for lesson ${lessonId}:`, error)
        errors++
      }
    }

    console.log(`Lesson cleanup complete: ${deleted} files deleted, ${errors} errors`)
    return { deleted, errors }
  } catch (error) {
    console.error(`Error cleaning up lesson ${lessonId}:`, error)
    return { deleted, errors: errors + 1 }
  }
}

/**
 * Cleanup the storage file for a single resource, only when it is not used by any lesson.
 */
export async function cleanupResourceFile(resourceId: number): Promise<{ deleted: boolean; error?: string }> {
  const supabase = createServiceRoleClient()

  try {
    const { data: resource, error: resourceError } = await supabase
      .from("resources")
      .select("id, s3_key, url")
      .eq("id", resourceId)
      .single()

    if (resourceError || !resource) {
      return { deleted: false, error: resourceError?.message || "Resource not found" }
    }

    const { data: usage } = await supabase
      .from("lesson_resources")
      .select("id")
      .eq("resource_id", resourceId)
      .limit(1)

    if (usage && usage.length > 0) {
      return { deleted: false, error: "Resource is still in use by lessons" }
    }

    try {
      if (await deleteStoredUrl(resource.url)) {
        return { deleted: true }
      }
      return { deleted: false, error: "Resource is not stored in Supabase Storage" }
    } catch (error: any) {
      console.error(`Error deleting resource file for resource ${resourceId}:`, error)
      return { deleted: false, error: error.message }
    }
  } catch (error: any) {
    console.error(`Error cleaning up resource ${resourceId}:`, error)
    return { deleted: false, error: error.message }
  }
}
