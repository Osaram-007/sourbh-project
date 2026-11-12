// WEB-B03 unit tests for the shared ContactForm. Criteria: WL-LAND-14, WL-A11Y (labels, honeypot), copy deck section C.
// Run: npx tsx --test tests/web/contact.test.tsx
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactForm } from "../../src/components/contact/ContactForm";
import { Checkbox } from "../../src/components/ui/Checkbox";
import { FieldError } from "../../src/components/ui/Field";
import { Input } from "../../src/components/ui/Input";
import { Select } from "../../src/components/ui/Select";
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

describe("ui controls: error announcement", () => {
  const cases: [string, (announce?: boolean) => React.ReactElement][] = [
    ["Input", (a) => <Input id="a" label="A" error="Bad" announce={a} />],
    ["Select", (a) => <Select id="a" label="A" error="Bad" announce={a}><option>x</option></Select>],
    ["Checkbox", (a) => <Checkbox id="a" label="A" error="Bad" announce={a} />],
  ];
  for (const [name, make] of cases) {
    it(`${name}: error keeps role=alert by default, announce={false} removes it`, () => {
      assert.match(renderToStaticMarkup(make()), /role="alert"/);
      const quiet = renderToStaticMarkup(make(false));
      assert.doesNotMatch(quiet, /role="alert"/);
      assert.match(quiet, /Bad/);
    });
  }
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
  it("is method=post with no action, so a no-JS submit cannot put fields in the URL (B1)", () => {
    const open = /<form\b[^>]*>/.exec(form)![0];
    assert.match(open, /\bmethod="post"/i);
    assert.doesNotMatch(open, /\baction=/i);
  });
  it("marks Organisation and Message (optional); Name and Email are not", () => {
    const label = (id: string) => new RegExp(`<label[^>]*for="contact-${id}"[^>]*>([\\s\\S]*?)</label>`).exec(form)?.[1] ?? "";
    assert.match(label("organisation"), /\(optional\)/);
    assert.match(label("message"), /\(optional\)/);
    assert.doesNotMatch(label("name"), /optional/);
    assert.doesNotMatch(label("email"), /optional/);
  });
  it("the submit button is not natively disabled and carries aria-disabled=false at rest", () => {
    const btn = /<button\b[^>]*type="submit"[^>]*>/.exec(form)?.[0] ?? "";
    assert.ok(btn);
    assert.doesNotMatch(btn, /\sdisabled[=\s>]/);
    assert.match(btn, /aria-disabled="false"/);
  });
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
