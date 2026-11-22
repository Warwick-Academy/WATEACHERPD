import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { generateCertificatePDF } from "@/lib/certificates/generate-pdf"
import { getCourseGradeAndHours } from "@/lib/certificates/course-grade"
import { CERTIFICATES_BUCKET, getStoragePath } from "@/lib/storage/shared"
import { uploadFile, downloadFile } from "@/lib/storage/server"
import { logError, logWarning, logInfo, createErrorResponse } from "@/lib/utils/errorHandler"
import { getBrandSettings } from "@/lib/supabase/brand-settings"

const CERTIFICATE_DESIGN_SUFFIX = "-light-blue-v1.pdf"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Extract id early to ensure it's in scope for error handling
  let certificateId: string = "unknown"
  try {
    // Await params since it's a Promise in Next.js 16
    const { id } = await params
    certificateId = id
    
    console.log("[Certificates API] Download request for certificate:", id)
    
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

    // Use service role client to bypass RLS and avoid infinite recursion
    const serviceSupabase = createServiceRoleClient()
    
    // Certificate ID is a UUID, not an integer - use it as-is
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      console.error("[Certificates API] Invalid certificate ID format (not a UUID):", id)
      return NextResponse.json({ error: "Invalid certificate ID format" }, { status: 400 })
    }
    
    // Fetch certificate with relations - use explicit foreign key syntax for profiles
    const { data: certificate, error } = await serviceSupabase
    .from("certificates")
    .select(`
      *,
      courses (
        id,
        title,
        certificate_enabled,
        certificate_template,
        certificate_title,
        certificate_description,
        signature_image,
        signature_name,
        signature_title,
        additional_text,
        certificate_type
      ),
      profiles:user_id (
        id,
        name
      )
    `)
      .eq("id", id)
    .maybeSingle()

  if (error) {
      console.error("[Certificates API] Error fetching certificate:", error)
      logError("Error fetching certificate", error, {
        component: "certificates/[id]/download/route",
        action: "GET",
        certificateId: certificateId,
        id,
      })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  if (!certificate) {
    console.error("[Certificates API] Certificate not found for id:", id)
    return NextResponse.json({ error: "Certificate not found" }, { status: 404 })
  }


    console.log("[Certificates API] Certificate found:", {
      id: certificate.id,
      courseId: certificate.course_id,
      certificateNumber: certificate.certificate_number,
      userId: certificate.user_id,
      hasCourse: !!certificate.courses,
      hasProfile: !!certificate.profiles,
    })

    // Validate required certificate data
    if (!certificate.certificate_number) {
      console.error("[Certificates API] Certificate missing certificate_number:", certificate.id)
      return NextResponse.json(
        { error: "Certificate data is incomplete", details: "Missing certificate_number" },
        { status: 500 }
      )
    }

    if (!certificate.course_id) {
      console.error("[Certificates API] Certificate missing course_id:", certificate.id)
      return NextResponse.json(
        { error: "Certificate data is incomplete", details: "Missing course_id" },
        { status: 500 }
      )
    }

  // Check if user owns this certificate or is admin
  if (certificate.user_id !== user.id) {
      // Use service role client to bypass RLS for admin check
      const { data: profile } = await serviceSupabase
      .from("profiles")
      .select("user_type")
      .eq("id", user.id)
      .single()

    if (profile?.user_type !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

    // Older PDFs stay in storage; regenerate them once for the current design.
    let pdfBuffer: Buffer
    const storedPath: string | null = certificate.certificate_url || null

    if (storedPath && !storedPath.startsWith("http") && storedPath.endsWith(CERTIFICATE_DESIGN_SUFFIX)) {
      try {
        pdfBuffer = await downloadFile(storedPath, CERTIFICATES_BUCKET)
        return new NextResponse(new Uint8Array(pdfBuffer), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="certificate-${certificate.certificate_number}.pdf"`,
            "Content-Length": pdfBuffer.length.toString(),
            "Cache-Control": "private, no-store",
          },
        })
      } catch (error) {
        // If download fails, regenerate the PDF
        logInfo("Failed to fetch existing PDF from storage, regenerating", { error: error instanceof Error ? error.message : String(error), certificateId: certificateId })
      }
    }
    // Legacy http(s) URLs (e.g. old S3 links) are ignored and the PDF is regenerated.

    // PDF doesn't exist or failed to download, generate new one
    // Use flat columns directly (database doesn't have settings JSONB column)
    let course = certificate.courses

    // If course relation didn't load, fetch it separately
    if (!course && certificate.course_id) {
      console.log("[Certificates API] Course relation not loaded, fetching separately for courseId:", certificate.course_id)
      const { data: courseData, error: courseError } = await serviceSupabase
        .from("courses")
        .select("id, title, certificate_enabled, certificate_template, certificate_title, certificate_description, signature_image, signature_name, signature_title, additional_text, certificate_type")
        .eq("id", certificate.course_id)
        .single()
      
      if (courseError) {
        console.error("[Certificates API] Error fetching course:", courseError)
        logError("Error fetching course for certificate", courseError, {
          component: "certificates/[id]/download/route",
          action: "GET",
          certificateId: certificateId,
          courseId: certificate.course_id,
        })
        return NextResponse.json(
          { error: "Failed to fetch course data", details: courseError.message },
          { status: 500 }
        )
      }
      course = courseData
    }

    if (!course) {
      console.error("[Certificates API] Course data not found for certificate:", certificateId, "courseId:", certificate.course_id)
      return NextResponse.json(
        { error: "Course data not found for this certificate" },
        { status: 500 }
      )
    }

    // Verify certificate is enabled for this course (using flat column directly)
    if (!course.certificate_enabled && !storedPath) {
      console.error("[Certificates API] Certificate is not enabled for this course:", course.id)
      return NextResponse.json(
        { error: "Certificate is not enabled for this course" },
        { status: 400 }
      )
    }

    // Fetch brand settings to use platform logo and name
    let logoUrl: string | undefined
    let organizationName: string | undefined
    let watermarkUrl: string | undefined
    
    try {
      const brandSettings = await getBrandSettings()
      // Use black logo for certificates (white background)
      // Check for valid non-empty URL
      logoUrl = (brandSettings.logoBlack && brandSettings.logoBlack.trim() !== "") 
        ? brandSettings.logoBlack 
        : undefined
      organizationName = (brandSettings.platformName && brandSettings.platformName.trim() !== "")
        ? brandSettings.platformName
        : undefined
      // The favicon (crest) is drawn large behind the text as a watermark
      watermarkUrl = (brandSettings.favicon && brandSettings.favicon.trim() !== "")
        ? brandSettings.favicon
        : logoUrl
      
      console.log("[Certificates API] Brand settings loaded:", {
        logoUrl,
        organizationName,
        logoBlack: brandSettings.logoBlack,
      })
    } catch (brandError) {
      // If brand settings fetch fails, log warning but continue with defaults
      logWarning("Failed to fetch brand settings for certificate", {
        component: "certificates/[id]/download/route",
        action: "GET",
        certificateId: certificateId,
        error: brandError instanceof Error ? brandError.message : String(brandError),
      })
      // Fallback to defaults if brand settings fetch fails
      logoUrl = "https://cldup.com/VQGhFU5kd6.svg"
      organizationName = "EaseLMS"
    }

    // Platform-wide certificate defaults: use the course's own value if set,
    // otherwise the platform default for the course's certificate type,
    // otherwise the built-in design.
    const certificateType = (course.certificate_type as "completion" | "participation" | "achievement") || "completion"
    let platformDefaults: Record<string, any> = {}
    try {
      const { data: platformSettings } = await serviceSupabase
        .from("platform_settings")
        .select("*")
        .limit(1)
        .maybeSingle()
      platformDefaults = platformSettings || {}
    } catch (settingsError) {
      logWarning("Failed to fetch platform certificate defaults", {
        component: "certificates/[id]/download/route",
        action: "GET",
        certificateId: certificateId,
        error: settingsError instanceof Error ? settingsError.message : String(settingsError),
      })
    }

    const defaultTemplate = platformDefaults[`certificate_template_${certificateType}`] || undefined
    const defaultDescription = platformDefaults[`certificate_description_${certificateType}`] || undefined
    const defaultAdditionalText = platformDefaults[`certificate_additional_text_${certificateType}`] || undefined
    const defaultSignatureImage = platformDefaults.certificate_signature_image || undefined
    const defaultSignatureName = platformDefaults.certificate_signature_name || undefined
    const defaultSignatureTitle = platformDefaults.certificate_signature_title || undefined

    // Compute the [Grade] and [PD Hours] placeholder values for this learner
    let grade: string | undefined
    let pdHours: string | undefined
    try {
      const result = await getCourseGradeAndHours(serviceSupabase, certificate.user_id, certificate.course_id)
      grade = result.grade || undefined
      pdHours = result.pdHours
    } catch (gradeError) {
      logWarning("Failed to compute certificate grade and PD hours", {
        component: "certificates/[id]/download/route",
        action: "GET",
        certificateId: certificateId,
        error: gradeError instanceof Error ? gradeError.message : String(gradeError),
      })
    }

    console.log("[Certificates API] Generating PDF with data:", {
      certificateNumber: certificate.certificate_number,
      learnerName: certificate.profiles?.name || "Student",
      courseTitle: course.title,
      certificateType,
      logoUrl: logoUrl || "NOT PROVIDED",
      organizationName: organizationName || "NOT PROVIDED",
      hasLogoUrl: !!logoUrl,
      logoUrlLength: logoUrl?.length || 0,
      grade,
      pdHours,
    })

    // Generate PDF certificate
    try {
    pdfBuffer = await generateCertificatePDF({
      certificateNumber: certificate.certificate_number,
      learnerName: certificate.profiles?.name || "Student",
        courseTitle: course.title || "Course",
      issuedAt: certificate.issued_at,
        certificateType,
        certificateTitle: course.certificate_title || undefined,
        certificateDescription: course.certificate_description || defaultDescription,
        certificateTemplate: course.certificate_template || defaultTemplate,
      organizationName,
      logoUrl,
        signatureImage: course.signature_image || defaultSignatureImage,
        signatureName: course.signature_name || defaultSignatureName,
        signatureTitle: course.signature_title || defaultSignatureTitle,
        additionalText: course.additional_text || defaultAdditionalText,
        grade,
        pdHours,
        watermarkUrl,
      })
      console.log("[Certificates API] PDF generated successfully, size:", pdfBuffer.length)
    } catch (pdfError: any) {
      console.error("[Certificates API] Error generating PDF:", pdfError)
      logError("Error generating certificate PDF", pdfError, {
        component: "certificates/[id]/download/route",
        action: "generatePDF",
        certificateId: certificateId,
        errorMessage: pdfError?.message,
        errorStack: pdfError?.stack,
      })
      throw pdfError // Re-throw to be caught by outer catch
    }

    // Upload the PDF to the private certificates bucket and remember its path
    const filename = `certificate-${certificate.certificate_number}${CERTIFICATE_DESIGN_SUFFIX}`
    const courseId = certificate.course_id
    const storageKey = getStoragePath("certificate", certificate.user_id, filename, undefined, undefined, courseId)

    console.log("[Certificates API] Uploading PDF to storage:", {
      certificateId: certificateId,
      courseId,
      storageKey,
      filename,
      bufferSize: pdfBuffer.length,
    })

    try {
      await uploadFile(pdfBuffer, storageKey, "application/pdf", CERTIFICATES_BUCKET)

      console.log("[Certificates API] PDF uploaded successfully:", { storageKey })

      // Save the storage path to the database (use service role client to bypass RLS)
      const { error: updateError } = await serviceSupabase
        .from("certificates")
        .update({ certificate_url: storageKey })
        .eq("id", id)

      if (updateError) {
        console.error("[Certificates API] Error updating certificate_url in database:", updateError)
        logError("Error updating certificate_url in database", updateError, {
          component: "certificates/[id]/download/route",
          action: "GET",
          certificateId: certificateId,
          storageKey,
        })
        // Don't fail the request, but log the error
      } else {
        console.log("[Certificates API] certificate_url updated in database:", storageKey)
      }
    } catch (uploadError) {
      console.error("[Certificates API] Error uploading certificate PDF to storage:", uploadError)
      logError("Error uploading certificate PDF to storage", uploadError, {
        component: "certificates/[id]/download/route",
        action: "GET",
        certificateId: certificateId,
        userId: certificate.user_id,
        courseId,
        storageKey,
        error: uploadError instanceof Error ? uploadError.message : String(uploadError),
        stack: uploadError instanceof Error ? uploadError.stack : undefined,
      })
      // Continue to return PDF even if upload fails - user can still download
    }

    // Return PDF as downloadable file
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="certificate-${certificate.certificate_number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error: any) {
    console.error("[Certificates API] Error in download route:", {
      error: error,
      message: error?.message,
      stack: error?.stack,
      certificateId: certificateId,
    })
    logError("Error in certificate download route", error, {
      component: "certificates/[id]/download/route",
      action: "GET",
      certificateId: certificateId,
      errorMessage: error?.message,
      errorStack: error?.stack,
      errorName: error?.name,
    })
    return NextResponse.json(
      { 
        error: "Failed to process certificate download", 
        details: error?.message || "Unknown error",
        // Include more details in development
        ...(process.env.NODE_ENV === "development" && { stack: error?.stack })
      },
      { status: 500 }
    )
  }
}

