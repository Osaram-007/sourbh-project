"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { controlClass, FieldError, FieldHint, fieldA11y } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ENQUIRY_HONEYPOT, ENQUIRY_MAX, type EnquiryErrorBody, type EnquiryRequest, type EnquiryType } from "@/lib/enquiries";

// Copy deck section C. Field errors do not announce on their own (announce={false}); on submit the first invalid field
// gets focus and its aria-describedby reads the error. Server and network errors use one role="alert" line.
const MSG = {
  name: "Please enter your name.",
  email: "Please enter a valid email address.",
  consent: "Please tick the box to agree.",
  tooLong: "Your message is too long. Please shorten it.",
  failed: "Your message did not send. Please try again.",
  rate: "You have sent several messages. Please try again later.",
};
const MESSAGE_HINT = "Tell us what you have in mind.";
const FIELDS = ["name", "email", "message", "consent"] as const;
type FieldName = (typeof FIELDS)[number];
type Errors = Partial<Record<FieldName, string>>;

const LABEL = "text-body-sm font-semibold text-ink";

export function ContactForm({ defaultType = "OTHER" }: { defaultType?: EnquiryType }) {
  const [errors, setErrors] = useState<Errors>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);

  // Focus after render so the field's aria-invalid / aria-describedby are already in place when it is read.
  useEffect(() => {
    if (focusId) document.getElementById(focusId)?.focus();
  }, [focusId, errors]);
  useEffect(() => {
    if (sent) successRef.current?.focus();
  }, [sent]);

  function showFieldErrors(next: Errors) {
    setErrors(next);
    const first = FIELDS.find((f) => next[f]);
    if (first) setFocusId(`contact-${first}`);
    return !!first;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const el = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
    const v = (n: string) => el(n).value;

    // Native constraints (required, type=email) are read from validity; noValidate keeps the browser's own bubbles off.
    const next: Errors = {};
    if (!v("name").trim()) next.name = MSG.name;
    if (!v("email").trim() || !el("email").validity.valid) next.email = MSG.email;
    if (!el("consent").checked) next.consent = MSG.consent;
    setFormError(null);
    if (showFieldErrors(next)) return;

    const body: EnquiryRequest = {
      name: v("name").trim(),
      email: v("email").trim(),
      organisation: v("organisation").trim(),
      type: v("type") as EnquiryType,
      message: v("message").trim(),
      consent: true,
      website: v(ENQUIRY_HONEYPOT),
    };
    setSending(true);
    try {
      const res = await fetch("/api/v1/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return setSent(true);
      if (res.status === 429) return setFormError(MSG.rate);
      if (res.status === 400) {
        const f = ((await res.json().catch(() => null)) as EnquiryErrorBody | null)?.fields ?? {};
        const mapped: Errors = {};
        if (f.name) mapped.name = MSG.name;
        if (f.email) mapped.email = MSG.email;
        if (f.message) mapped.message = MSG.tooLong;
        if (f.consent) mapped.consent = MSG.consent;
        if (showFieldErrors(mapped)) return;
      }
      setFormError(MSG.failed); // 403, other statuses, unmapped 400
    } catch {
      setFormError(MSG.failed);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div ref={successRef} tabIndex={-1} className="max-w-xl rounded-control border border-border-strong bg-mint p-6 text-lead font-semibold text-ink focus:outline-none">
        Thanks. We have your message.
      </div>
    );
  }

  const a11y = (f: FieldName, hint?: string) => fieldA11y(`contact-${f}`, { hint, error: errors[f] });
  const err = (f: FieldName, cls?: string) =>
    errors[f] ? (
      <FieldError id={`contact-${f}`} announce={false} className={cls}>
        {errors[f]}
      </FieldError>
    ) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="relative flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-name" className={LABEL}>Name</label>
        <input id="contact-name" name="name" required maxLength={ENQUIRY_MAX.name} autoComplete="name" className={controlClass} {...a11y("name")} />
        {err("name")}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-email" className={LABEL}>Email</label>
        <input id="contact-email" name="email" type="email" required maxLength={ENQUIRY_MAX.email} autoComplete="email" className={controlClass} {...a11y("email")} />
        {err("email")}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-organisation" className={LABEL}>Organisation</label>
        <input id="contact-organisation" name="organisation" maxLength={ENQUIRY_MAX.organisation} autoComplete="organization" className={controlClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-type" className={LABEL}>Type of enquiry</label>
        <select id="contact-type" name="type" defaultValue={defaultType} className={controlClass}>
          <option value="BUSINESS">Business</option>
          <option value="OPERATOR">Charging operator</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-message" className={LABEL}>Message</label>
        <FieldHint id="contact-message">{MESSAGE_HINT}</FieldHint>
        <textarea id="contact-message" name="message" rows={5} maxLength={ENQUIRY_MAX.message} className={`${controlClass} py-2`} {...a11y("message", MESSAGE_HINT)} />
        {err("message")}
      </div>
      {/* Honeypot: off-screen, out of the tab order and the accessibility tree. Real users never fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name={ENQUIRY_HONEYPOT} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <input id="contact-consent" name="consent" type="checkbox" required className="size-target-min shrink-0 cursor-pointer accent-brand focus-ring" {...a11y("consent")} />
          <label htmlFor="contact-consent" className="pt-px text-body text-ink">
            I agree that FullCharge can store my message and contact me about it. I have read the{" "}
            <a href="/legal/privacy" className="font-semibold underline">Privacy Policy</a>.
          </label>
        </div>
        {err("consent", "pl-9")}
      </div>
      {formError ? <p role="alert" className="text-body font-semibold text-ink">{formError}</p> : null}
      <div>
        <Button type="submit" disabled={sending}>Send Message</Button>
      </div>
    </form>
  );
}
