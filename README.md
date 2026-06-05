# 💌 Date ask

A tiny, mobile-first single-page site that asks one person on a date:
**will you?**, **when?**, and **where?** — then emails the answer.

- `public/index.html` — the whole site (no build, no dependencies).
- Responses are emailed via [FormSubmit](https://formsubmit.co) (no account/keys).
- Hosted on **GitHub Pages** via `.github/workflows/deploy.yml`.
- `.github/workflows/formsubmit-setup.yml` is a one-time helper to activate
  email delivery (FormSubmit requires confirming the destination address once).

## How responses reach the inbox
The form posts directly to FormSubmit from the visitor's browser, which
forwards the answer as an email to `yonatan@thepipelinegroup.io`.
