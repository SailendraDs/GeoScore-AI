import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"
import { ResponsiveNav } from "@/components/navigation/responsive-nav"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "GeoScore AI - AI Visibility Platform",
  description: "Track your brand visibility across AI engines like ChatGPT, Claude, Gemini, and more",
  keywords: ["AI SEO", "brand visibility", "ChatGPT", "Claude", "AI marketing"],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <ResponsiveNav />
          <div className="lg:pl-64">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  )
}