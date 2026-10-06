"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import type { DeckTheme } from "@/lib/presentation";
import { registerDeckGsap } from "./choreo";
import s from "./deck.module.css";
import { THEMES } from "./themes";

/**
 * What lies behind the slides: the theme's texture, three soft glows and the
 * accent fill. The glows travel to new places on every slide (the same places
 * every time for the same slide), so moving through a deck feels like moving
 * through one space rather than cutting between cards. A slide in the accent
 * tone fills the stage with a circle that grows from the side the deck is
 * moving towards, and shrinks away when the deck moves on.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function Backdrop({
  theme,
  index,
  accent,
  direction,
  reduce,
}: {
  theme: DeckTheme;
  index: number;
  accent: boolean;
  direction: 1 | -1;
  reduce: boolean;
}) {
  const glows = useRef<(HTMLDivElement | null)[]>([]);
  const fill = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const shownAccent = useRef<boolean | null>(null);
  const pattern = THEMES[theme].pattern;

  useLayoutEffect(() => {
    registerDeckGsap();
    const spots = spotsFor(index);
    glows.current.forEach((el, i) => {
      if (!el) return;
      if (!placed.current || reduce) gsap.set(el, { ...spots[i], xPercent: -50, yPercent: -50 });
      else gsap.to(el, { ...spots[i], duration: 2.6, delay: i * 0.07, ease: "deck-in-out", overwrite: "auto" });
    });
    placed.current = true;
  }, [index, reduce]);

  useLayoutEffect(() => {
    const el = fill.current;
    if (!el) return;
    const near = direction > 0 ? "100%" : "0%";
    const far = direction > 0 ? "0%" : "100%";
    if (shownAccent.current === null || reduce) {
      gsap.set(el, { clipPath: accent ? `circle(150% at ${near} 50%)` : `circle(0% at ${near} 50%)` });
    } else if (accent && !shownAccent.current) {
      gsap.fromTo(el, { clipPath: `circle(0% at ${near} 50%)` }, { clipPath: `circle(150% at ${near} 50%)`, duration: 1.15, ease: "deck-in-out", overwrite: "auto" });
    } else if (!accent && shownAccent.current) {
      gsap.fromTo(el, { clipPath: `circle(150% at ${far} 50%)` }, { clipPath: `circle(0% at ${far} 50%)`, duration: 1.05, ease: "deck-in-out", overwrite: "auto" });
    }
    shownAccent.current = accent;
  }, [accent, direction, reduce]);

  return (
    <div aria-hidden="true" className={s.backdrop}>
      {(["glowA", "glowB", "glowC"] as const).map((glow, i) => (
        <div
          key={glow}
          ref={(el) => {
            glows.current[i] = el;
          }}
          className={s.glow}
        >
          <div className={`${s.glowInner} ${s[glow]}`} style={{ animationDuration: `${17 + i * 6}s`, animationDelay: `${-i * 5}s` }} />
        </div>
      ))}
      {pattern !== "none" && <div className={s.pattern} data-pattern={pattern} />}
      <div ref={fill} className={s.accentLayer} />
    </div>
  );
}

/** Three places and sizes for the glows on slide `index`: spread out, and stable for that slide. */
function spotsFor(index: number): { left: string; top: string; scale: number }[] {
  const random = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  // Each glow keeps to its own third of the stage, so they never pile up in one corner.
  const lanes = [
    [-0.1, 0.45],
    [0.3, 0.75],
    [0.6, 1.1],
  ];
  return lanes.map(([from, to], i) => ({
    left: `${((from + random(index * 3 + i) * (to - from)) * 100).toFixed(1)}%`,
    top: `${((-0.15 + random(index * 3 + i + 17) * 1.3) * 100).toFixed(1)}%`,
    scale: 0.65 + random(index * 3 + i + 41) * 0.65,
  }));
}
