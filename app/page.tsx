import type { Metadata } from "next";
import { Marquee } from "@/components/motion/Marquee";
import { ScrollProgress } from "@/components/motion/primitives";
import { IntegrityLevels } from "@/components/landing/IntegrityLevels";
import { ScrollToTop } from "@/components/landing/ScrollToTop";
import { StaffHero } from "@/components/landing/StaffHero";
import { StaffLandingNav } from "@/components/landing/StaffLandingNav";
import {
  ForUniversities,
  LiveExamSteps,
  StaffClosing,
  StaffFooter,
  ToolsSection,
} from "@/components/landing/staffSections";

export const metadata: Metadata = {
  title: "Kalami AntiCheat · The control room for honest exams",
};

export default function StaffLandingPage() {
  return (
    <>
      <ScrollProgress />
      <StaffLandingNav />
      <main>
        <StaffHero />
        <Marquee
          className="mt-16 text-2xl font-medium tracking-[-0.02em] text-graphite sm:text-4xl"
          items={[
            "Live class view",
            "Unlock in one click",
            "Red-pen grading",
            "Similarity reports",
            "Server-kept time",
            "You decide",
          ]}
        />
        <ToolsSection />
        <LiveExamSteps />
        <IntegrityLevels />
        <ForUniversities />
        <StaffClosing />
      </main>
      <StaffFooter />
      <ScrollToTop />
    </>
  );
}
