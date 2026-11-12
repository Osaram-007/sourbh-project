"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { controlClass, Field, fieldA11y } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
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

export function ContactForm({ defaultType = "OTHER" }: { defaultType?: EnquiryType }) {
  const [errors, setErrors] = useState<Errors>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

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
    setFocusId(first ? `contact-${first}` : null);
    return !!first;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sendingRef.current) return; // aria-disabled keeps the button focusable, so Enter / click still arrive here
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
    sendingRef.current = true;
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
      sendingRef.current = false;
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

  return (
    // method="post", no action: without JS a native submit must never put the fields in the URL (WL-SEC-8).
    <form method="post" onSubmit={onSubmit} noValidate className="relative flex max-w-xl flex-col gap-5">
      <Input id="contact-name" name="name" label="Name" required maxLength={ENQUIRY_MAX.name} autoComplete="name" error={errors.name} announce={false} />
      <Input id="contact-email" name="email" type="email" label="Email" required maxLength={ENQUIRY_MAX.email} autoComplete="email" error={errors.email} announce={false} />
      <Input id="contact-organisation" name="organisation" label="Organisation (optional)" maxLength={ENQUIRY_MAX.organisation} autoComplete="organization" />
      <Select id="contact-type" name="type" label="Type of enquiry" defaultValue={defaultType}>
        <option value="BUSINESS">Business</option>
        <option value="OPERATOR">Charging operator</option>
        <option value="OTHER">Other</option>
      </Select>
      <Field id="contact-message" label="Message (optional)" hint={MESSAGE_HINT} error={errors.message} announce={false}>
        <textarea
          id="contact-message"
          name="message"
          rows={5}
          maxLength={ENQUIRY_MAX.message}
          className={`${controlClass} py-2`}
          {...fieldA11y("contact-message", { hint: MESSAGE_HINT, error: errors.message })}
        />
      </Field>
      {/* Honeypot: off-screen, out of the tab order and the accessibility tree. Real users never fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name={ENQUIRY_HONEYPOT} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <Checkbox
        id="contact-consent"
        name="consent"
        required
        error={errors.consent}
        announce={false}
        label={
          <>
            I agree that FullCharge can store my message and contact me about it. I have read the{" "}
            <a href="/legal/privacy" className="font-semibold underline">Privacy Policy</a>.
          </>
        }
      />
      {formError ? <p role="alert" className="text-body font-semibold text-ink">{formError}</p> : null}
      <div>
        {/* aria-disabled, not disabled: the focused button keeps focus, and the label change below is what a screen reader hears. */}
        <Button type="submit" aria-disabled={sending}>{sending ? "Sending…" : "Send Message"}</Button>
      </div>
    </form>
  );
}
