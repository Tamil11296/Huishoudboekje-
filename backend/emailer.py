import os
import re
import ipaddress
import logging
import httpx
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Optioneel: e-mail via Resend (resend.com). Zonder sleutel toont de app de uitnodigingslink
# om zelf te delen (bijv. via WhatsApp).
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "")  # bijv. "Huishoudboekje <noreply@jouwdomein.nl>"
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")


def email_enabled() -> bool:
    return bool(RESEND_API_KEY and EMAIL_FROM)

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    if not email_enabled():
        return None
    _assert_safe_email(subject, html)
    payload = {"from": EMAIL_FROM, "to": [to], "subject": subject, "html": html}
    if EMAIL_REPLY_TO:
        payload["reply_to"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post("https://api.resend.com/emails",
                                     headers={"Authorization": f"Bearer {RESEND_API_KEY}"}, json=payload)
        resp.raise_for_status()
        return resp.json().get("id")
    except Exception as e:
        logger.error(f"Email send error: {str(e)}")
        return None


def invite_email_html(inviter_name: str, household_name: str, invite_link: str) -> str:
    return (
        f'<table role="presentation" width="100%" style="background:#f8fafc;padding:24px">'
        f'<tr><td align="center"><table role="presentation" width="520" '
        f'style="background:#ffffff;border-radius:12px;font-family:Arial,sans-serif;'
        f'border:1px solid #e2e8f0"><tr><td style="padding:32px">'
        f'<p style="font-size:20px;font-weight:bold;color:#0f172a;margin:0 0 16px">'
        f'Huishoudboekje</p>'
        f'<p style="color:#334155">{escape(inviter_name)} nodigt je uit om samen te werken aan '
        f'het huishouden <strong>{escape(household_name)}</strong>.</p>'
        f'<p style="color:#334155">Klik op de knop hieronder om de uitnodiging te accepteren en '
        f'in te loggen.</p>'
        f'<p style="margin:28px 0"><a href="{escape(invite_link)}" '
        f'style="background:#0f172a;color:#ffffff;padding:12px 24px;border-radius:9999px;'
        f'text-decoration:none;font-weight:bold">Uitnodiging accepteren</a></p>'
        f'<p style="font-size:12px;color:#94a3b8">Verwachtte je deze e-mail niet? Dan kun je hem '
        f'negeren. We vragen je nooit om je wachtwoord per e-mail.</p>'
        f'<p style="font-size:12px;color:#94a3b8">Verzonden door Huishoudboekje.</p>'
        f'</td></tr></table></td></tr></table>'
    )
