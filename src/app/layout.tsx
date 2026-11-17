import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Cyraops CRM", description: "Cyraops team projects, files, conversations, and schedules in one place." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
