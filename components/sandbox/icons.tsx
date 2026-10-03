import type { SVGProps } from "react";

// Line icons for the sandbox, kept here so the folder works in both apps unchanged.

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const ArrowLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const ArrowRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const Lock = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const Refresh = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.6M20 5v6h-6" />
  </Icon>
);

export const Phone = (props: IconProps) => (
  <Icon {...props}>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M11 18h2" />
  </Icon>
);

export const Desktop = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </Icon>
);

export const Bulb = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z" />
  </Icon>
);

export const ImageIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5-9 9" />
  </Icon>
);

export const EyeOff = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a15 15 0 0 1-3 3.5M6.3 7.8A15 15 0 0 0 2.5 12c1 1.5 4.5 6 9.5 6a9 9 0 0 0 4-.9" />
  </Icon>
);

export const Pen = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4ZM14 6l3 3" />
  </Icon>
);
