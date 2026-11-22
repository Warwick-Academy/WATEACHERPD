import { Metadata } from "next"
import { generatePageMetadata } from "@/lib/metadata"

export async function generateMetadata(): Promise<Metadata> {
  const metadata = await generatePageMetadata("Sign Up")
  
  // Allow indexing for auth pages
  return {
    ...metadata,
    title: typeof metadata.title === "string" ? { absolute: metadata.title } : metadata.title,
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        noarchive: true,
      },
    },
  }
}

export default function LearnerSignupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
