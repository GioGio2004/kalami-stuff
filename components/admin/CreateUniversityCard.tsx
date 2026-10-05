"use client";

import { useState, type FormEvent } from "react";
import { ArrowButton } from "@/components/ui/buttons";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { Building } from "@/components/ui/icons";
import { errorMessage } from "@/lib/errors";

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** The super admin adds a university: both names and the short name used in links. */
export function CreateUniversityCard({
  onCreate,
}: {
  onCreate: (args: { nameKa: string; nameEn: string; slug: string }) => Promise<unknown>;
}) {
  const [nameKa, setNameKa] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownSlug = slugEdited ? slug : slugify(nameEn);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onCreate({ nameKa, nameEn, slug: shownSlug });
      setNameKa("");
      setNameEn("");
      setSlug("");
      setSlugEdited(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-[2rem] bg-card p-6 sm:p-7">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-panel">
          <Building className="size-5" />
        </span>
        <h2 className="text-xl font-medium tracking-tight">Add a university</h2>
      </div>
      <Field label="Name in Georgian" htmlFor="uni-ka">
        <TextInput
          id="uni-ka"
          required
          placeholder="გორის სახელმწიფო უნივერსიტეტი"
          value={nameKa}
          onChange={(e) => setNameKa(e.target.value)}
        />
      </Field>
      <Field label="Name in English" htmlFor="uni-en">
        <TextInput
          id="uni-en"
          required
          placeholder="Gori State University"
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
        />
      </Field>
      <Field label="Short name" htmlFor="uni-slug" hint="Lowercase letters, digits and dashes. Used in links.">
        <TextInput
          id="uni-slug"
          required
          placeholder="gori-state"
          value={shownSlug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
          className="font-mono"
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      <ArrowButton type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add university"}
      </ArrowButton>
    </form>
  );
}
