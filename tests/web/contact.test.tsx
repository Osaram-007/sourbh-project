// WEB-B03 unit tests for the shared ContactForm. Criteria: WL-LAND-14, WL-A11Y (labels, honeypot), copy deck section C.
// Run: npx tsx --test tests/web/contact.test.tsx
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactForm } from "../../src/components/contact/ContactForm";
import { FieldError } from "../../src/components/ui/Field";
import { ENQUIRY_HONEYPOT, ENQUIRY_MAX, ENQUIRY_TYPES } from "../../src/lib/enquiries";

const form = renderToStaticMarkup(<ContactForm />);
const tag = (name: string) => new RegExp(`<(?:input|textarea|select)\\b[^>]*\\bname="${name}"[^>]*>`).exec(form)?.[0] ?? "";

describe("FieldError", () => {
  it("keeps role=alert by default", () => {
    assert.match(renderToStaticMarkup(<FieldError id="x">Bad</FieldError>), /\brole="alert"/);
  });
  it("announce={false} removes role=alert but keeps the id the control points at", () => {
    const html = renderToStaticMarkup(<FieldError id="x" announce={false}>Bad</FieldError>);
    assert.doesNotMatch(html, /role=/);
    assert.match(html, /\bid="x-error"/);
    assert.match(html, /Bad/);
  });
});

describe("enquiry contract constants vs the form", () => {
  for (const f of ["name", "email", "organisation", "message"] as const) {
    it(`${f} maxLength is ENQUIRY_MAX.${f}`, () => {
      assert.match(tag(f), new RegExp(`\\bmaxLength="${ENQUIRY_MAX[f]}"`, "i"));
    });
  }
  it("the honeypot input is named after ENQUIRY_HONEYPOT, out of the tab order", () => {
    assert.equal(ENQUIRY_HONEYPOT, "website");
    assert.match(tag(ENQUIRY_HONEYPOT), /tabindex="-1"/i);
  });
  it("offers exactly the contract's types", () => {
    const values = [...form.matchAll(/<option value="([A-Z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(values, [...ENQUIRY_TYPES]);
  });
  it("defaultType selects that option", () => {
    const html = renderToStaticMarkup(<ContactForm defaultType="OPERATOR" />);
    assert.match(html, /<option value="OPERATOR" selected/);
    assert.match(form, /<option value="OTHER" selected/);
  });
});

describe("form markup", () => {
  it("is noValidate with native required on name, email and consent", () => {
    assert.match(form, /<form\b[^>]*\bnovalidate/i);
    for (const n of ["name", "email", "consent"]) assert.match(tag(n), /\brequired/);
    assert.match(tag("email"), /type="email"/);
  });
  it("starts with no field errors and no alert", () => {
    assert.doesNotMatch(form, /role="alert"/);
    assert.doesNotMatch(form, /aria-invalid="true"/);
  });
});
