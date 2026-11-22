"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Award, Save, Edit, X } from "lucide-react"
import { toast } from "sonner"
import { useSettings, useUpdateSettings } from "@/lib/react-query/hooks"

const CERTIFICATE_TYPES = [
  { key: "completion", label: "Completion" },
  { key: "participation", label: "Participation" },
  { key: "achievement", label: "Achievement" },
] as const

type CertificateTypeKey = (typeof CERTIFICATE_TYPES)[number]["key"]

interface CertificateDefaults {
  templates: Record<CertificateTypeKey, string>
  descriptions: Record<CertificateTypeKey, string>
  additionalTexts: Record<CertificateTypeKey, string>
  signatureImage: string
  signatureName: string
  signatureTitle: string
}

const EMPTY_DEFAULTS: CertificateDefaults = {
  templates: { completion: "", participation: "", achievement: "" },
  descriptions: { completion: "", participation: "", achievement: "" },
  additionalTexts: { completion: "", participation: "", achievement: "" },
  signatureImage: "",
  signatureName: "",
  signatureTitle: "",
}

export default function CertificateSettings() {
  const { data: settingsData, isPending: settingsPending } = useSettings()
  const updateSettingsMutation = useUpdateSettings()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [defaults, setDefaults] = useState<CertificateDefaults>(EMPTY_DEFAULTS)
  const initialRef = useRef<CertificateDefaults | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settingsData?.platformSettings) {
      const settings = settingsData.platformSettings as Record<string, any>
      const loaded: CertificateDefaults = {
        templates: {
          completion: settings.certificate_template_completion || "",
          participation: settings.certificate_template_participation || "",
          achievement: settings.certificate_template_achievement || "",
        },
        descriptions: {
          completion: settings.certificate_description_completion || "",
          participation: settings.certificate_description_participation || "",
          achievement: settings.certificate_description_achievement || "",
        },
        additionalTexts: {
          completion: settings.certificate_additional_text_completion || "",
          participation: settings.certificate_additional_text_participation || "",
          achievement: settings.certificate_additional_text_achievement || "",
        },
        signatureImage: settings.certificate_signature_image || "",
        signatureName: settings.certificate_signature_name || "",
        signatureTitle: settings.certificate_signature_title || "",
      }
      setDefaults(loaded)
      if (!initialRef.current) {
        initialRef.current = loaded
      }
    }
  }, [settingsData])

  const handleEdit = () => {
    setIsEditing(true)
    if (initialRef.current) {
      setDefaults({ ...initialRef.current })
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    setError(null)
    if (initialRef.current) {
      setDefaults({ ...initialRef.current })
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)

    try {
      const platformSettings = {
        certificate_template_completion: defaults.templates.completion || null,
        certificate_template_participation: defaults.templates.participation || null,
        certificate_template_achievement: defaults.templates.achievement || null,
        certificate_description_completion: defaults.descriptions.completion || null,
        certificate_description_participation: defaults.descriptions.participation || null,
        certificate_description_achievement: defaults.descriptions.achievement || null,
        certificate_additional_text_completion: defaults.additionalTexts.completion || null,
        certificate_additional_text_participation: defaults.additionalTexts.participation || null,
        certificate_additional_text_achievement: defaults.additionalTexts.achievement || null,
        certificate_signature_image: defaults.signatureImage || null,
        certificate_signature_name: defaults.signatureName || null,
        certificate_signature_title: defaults.signatureTitle || null,
      }

      await updateSettingsMutation.mutateAsync({ platformSettings })

      initialRef.current = { ...defaults }
      if (settingsData) {
        settingsData.platformSettings = {
          ...settingsData.platformSettings,
          ...platformSettings,
        }
      }

      setIsEditing(false)
      toast.success("Certificate defaults saved successfully")
    } catch (err: any) {
      console.error("Error saving certificate defaults:", err)
      setError(err.message || "Failed to save certificate defaults")
      toast.error(err.message || "Failed to save certificate defaults")
    } finally {
      setIsSaving(false)
    }
  }

  if (settingsPending) {
    return <div className="text-muted-foreground">Loading certificate settings...</div>
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center">
                <Award className="mr-2 h-5 w-5" /> Certificate Defaults
              </CardTitle>
              <CardDescription>
                Used when a course has no certificate settings of its own. Descriptions and additional text
                support the placeholders [Student Name], [Course Name], [Grade] and [PD Hours].
              </CardDescription>
            </div>
            {!isEditing ? (
              <Button onClick={handleEdit} variant="outline" size="sm">
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button onClick={handleCancel} variant="outline" size="sm" disabled={isSaving}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button onClick={handleSave} size="sm" disabled={isSaving}>
                  <Save className="mr-2 h-4 w-4" />
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          {CERTIFICATE_TYPES.map(({ key, label }) => (
            <div key={key} className="space-y-4 border-b pb-6 last:border-b-0 last:pb-0">
              <h3 className="text-base font-semibold">{label} certificates</h3>

              <div className="space-y-2">
                <Label htmlFor={`certificate-template-${key}`}>Default template image URL</Label>
                <Input
                  id={`certificate-template-${key}`}
                  value={defaults.templates[key]}
                  onChange={(e) => setDefaults((prev) => ({
                    ...prev,
                    templates: { ...prev.templates, [key]: e.target.value },
                  }))}
                  placeholder={`https://example.com/certificate-${key}.png`}
                  className="max-w-2xl"
                  disabled={!isEditing}
                />
                <p className="text-sm text-muted-foreground">
                  Paste a full image URL for the certificate background (A4 landscape works best).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`certificate-description-${key}`}>Default description</Label>
                <Textarea
                  id={`certificate-description-${key}`}
                  value={defaults.descriptions[key]}
                  onChange={(e) => setDefaults((prev) => ({
                    ...prev,
                    descriptions: { ...prev.descriptions, [key]: e.target.value },
                  }))}
                  rows={2}
                  className="max-w-2xl"
                  disabled={!isEditing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`certificate-additional-${key}`}>Default additional text</Label>
                <Textarea
                  id={`certificate-additional-${key}`}
                  value={defaults.additionalTexts[key]}
                  onChange={(e) => setDefaults((prev) => ({
                    ...prev,
                    additionalTexts: { ...prev.additionalTexts, [key]: e.target.value },
                  }))}
                  rows={2}
                  className="max-w-2xl"
                  disabled={!isEditing}
                />
              </div>
            </div>
          ))}

          <div className="space-y-4">
            <h3 className="text-base font-semibold">Default signature</h3>

            <div className="space-y-2">
              <Label htmlFor="certificate-signature-image">Signature image URL</Label>
              <Input
                id="certificate-signature-image"
                value={defaults.signatureImage}
                onChange={(e) => setDefaults((prev) => ({ ...prev, signatureImage: e.target.value }))}
                placeholder="https://example.com/brand/signature.png"
                className="max-w-2xl"
                disabled={!isEditing}
              />
              {defaults.signatureImage && (
                <div className="h-14 w-auto inline-block border rounded p-2 bg-white">
                  <img src={defaults.signatureImage} alt="Signature preview" className="h-full w-auto object-contain" />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-signature-name">Signer name</Label>
              <Input
                id="certificate-signature-name"
                value={defaults.signatureName}
                onChange={(e) => setDefaults((prev) => ({ ...prev, signatureName: e.target.value }))}
                placeholder="Jane Doe"
                className="max-w-md"
                disabled={!isEditing}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-signature-title">Signer title</Label>
              <Input
                id="certificate-signature-title"
                value={defaults.signatureTitle}
                onChange={(e) => setDefaults((prev) => ({ ...prev, signatureTitle: e.target.value }))}
                placeholder="Director of Professional Development"
                className="max-w-md"
                disabled={!isEditing}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
