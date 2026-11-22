import { Metadata } from "next"
import { generatePageMetadata } from "@/lib/metadata"

export async function generateMetadata(): Promise<Metadata> {
  const metadata = await generatePageMetadata("New Password")

  // Hide password reset pages from search engines
  return {
    ...metadata,
    title: typeof metadata.title === "string" ? { absolute: metadata.title } : metadata.title,
    robots: {
      index: false,
      follow: false,
    },
  }
}

export default function NewPasswordLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
