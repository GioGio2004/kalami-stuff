import { appError } from "./errors";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function requireEmail(value: string): string {
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw appError("INVALID_INPUT", "Enter a valid email address.");
  }
  return email;
}

export function requireText(value: string, label: string, maxLength: number): string {
  const text = value.trim();
  if (text === "") {
    throw appError("INVALID_INPUT", `${label} is required.`);
  }
  if (text.length > maxLength) {
    throw appError("INVALID_INPUT", `${label} must be at most ${maxLength} characters.`);
  }
  return text;
}

export function optionalText(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return requireText(value, label, maxLength);
}
