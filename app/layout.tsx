import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Caveat, Geist, Geist_Mono, Noto_Sans_Georgian } from "next/font/google";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { CurrentUserProvider } from "@/components/CurrentUserProvider";
import { clerkAppearance } from "@/lib/clerkAppearance";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist has no Georgian letters; the font stacks fall through to this one.
const georgian = Noto_Sans_Georgian({
  variable: "--font-georgian",
  subsets: ["georgian"],
});

// Handwritten accents only (red-pen notes), never body text.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kalami AntiCheat",
  description: "Course studio, live exam monitoring and red-pen grading for lecturers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${georgian.variable} ${caveat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* ClerkProvider must wrap the Convex provider, which reads Clerk's session. */}
        <MotionProvider>
          <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" signUpUrl="/sign-up">
            <ConvexClientProvider>
              <CurrentUserProvider>{children}</CurrentUserProvider>
            </ConvexClientProvider>
          </ClerkProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
