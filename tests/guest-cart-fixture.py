"""Opt-in local fixture control for one guest-cart browser run.

This is not a Django management command or an HTTP endpoint. It does nothing
unless PHOENIX_GUEST_CART_FIXTURE=1. It accepts cart IDs on stdin and never
prints tokens, token hashes, or CSRF values.
"""

import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import timedelta
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "base.settings")
_backend = os.environ.get("PHOENIX_BACKEND_ROOT")
if _backend:
    sys.path.insert(0, _backend)

_HEX_64 = re.compile(r"[0-9a-fA-F]{64}")
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")


def safe_error(exc):
    text = _TOKEN.sub("[redacted]", _HEX_64.sub("[redacted]", str(exc)))
    return text[:300]


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


if os.environ.get("PHOENIX_GUEST_CART_FIXTURE") != "1":
    emit({"ok": False, "error": "fixture opt-in missing"})
    sys.exit(2)

import django

django.setup()

import logging

logging.disable(logging.CRITICAL)

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from cart.models import Cart, GuestSession
from orders.models import Order

STARTED = None
RUN_ID = ""
ALLOW = {}
BACKUP = ""
EXPECTED_DB = (Path(settings.BASE_DIR) / "db.sqlite3").resolve()
BACKUP_DIR = Path(settings.BASE_DIR).parent / "local-db-backups"


def database_ready():
    database = settings.DATABASES["default"]
    engine = database.get("ENGINE")
    name = database.get("NAME")
    resolved = Path(name).resolve() if name else None
    routers = list(getattr(settings, "DATABASE_ROUTERS", []) or [])
    if engine != "django.db.backends.sqlite3":
        return "database engine is not sqlite"
    if resolved != EXPECTED_DB:
        return "database path is not the repository db.sqlite3"
    if database.get("HOST") or database.get("PORT"):
        return "database connection has a remote host"
    if routers:
        return "a database router is configured"
    if not EXPECTED_DB.is_file():
        return "repository db.sqlite3 is missing"
    from django.db.migrations.executor import MigrationExecutor
    from django.db import connection

    executor = MigrationExecutor(connection)
    if executor.migration_plan(executor.loader.graph.leaf_nodes()):
        return "required migrations are not applied"
    return ""


def backup_database():
    global BACKUP
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = timezone.localtime().strftime("%Y%m%dT%H%M%S")
    destination = BACKUP_DIR / f"guest-cart-lifecycle-{stamp}.sqlite3"
    source = sqlite3.connect(EXPECTED_DB, timeout=30)
    try:
        target = sqlite3.connect(destination)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()
    BACKUP = str(destination)
    return BACKUP


def parse_cart_id(value):
    if not isinstance(value, str) or not value:
        raise ValueError("cart id is missing")
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise ValueError("cart id is not a UUID") from exc
    if str(parsed) != value.lower():
        raise ValueError("cart id is not canonical")
    return parsed


def session_order_fields():
    fields = []
    for field in Order._meta.get_fields():
        if getattr(field, "related_model", None) is GuestSession and getattr(field, "many_to_one", False):
            fields.append(field.name)
    return fields


def order_refers(cart_id, session):
    if Order.objects.filter(source_cart_id=cart_id).exists():
        return True
    for name in session_order_fields():
        if Order.objects.filter(**{name: session}).exists():
            return True
    return False


def public_record(cart, session, registered):
    current = None
    if session is not None:
        current = Cart.objects.filter(guest_session_id=session.pk).values_list("id", flat=True).first()
    return {
        "ok": True,
        "cart_exists": cart is not None,
        "item_count": cart.items.count() if cart is not None else 0,
        "user_null": cart is None or cart.user_id is None,
        "orders": Order.objects.filter(source_cart_id=registered["cart_id"]).count(),
        "session_exists": session is not None,
        "expired": bool(session and session.expires_at <= timezone.now()),
        "revoked": bool(session and session.revoked_at is not None),
        "token_unchanged": bool(session and session.token_hash == registered["token_hash"]),
        "expires_unchanged": bool(session and session.expires_at == registered["expires_at"]),
        "revoked_unchanged": bool(
            session and (session.revoked_at is None) == (registered["revoked_at"] is None)
        ),
        "session_cart_id": str(current) if current else "",
    }


def load_registered(cart_id):
    parsed = parse_cart_id(cart_id)
    registered = ALLOW.get(str(parsed))
    if registered is None:
        raise ValueError("cart is not in this run allowlist")
    return parsed, registered


def guarded_cart(parsed, registered):
    cart = Cart.objects.filter(pk=parsed).first()
    if cart is None:
        raise ValueError("cart is no longer present")
    if cart.created_at <= STARTED:
        raise ValueError("cart was not created after this run started")
    if cart.user_id is not None:
        raise ValueError("cart has an authenticated user")
    if cart.guest_session_id is None:
        raise ValueError("cart has no guest session")
    session = GuestSession.objects.filter(pk=cart.guest_session_id).first()
    if session is None:
        raise ValueError("guest session is missing")
    if str(session.pk) != registered["session_id"]:
        raise ValueError("session association does not match registration")
    if session.created_at <= STARTED:
        raise ValueError("guest session was not created after this run started")
    if order_refers(cart.pk, session):
        raise ValueError("an order refers to this cart or session")
    return cart, session


def register(cart_id):
    parsed = parse_cart_id(cart_id)
    key = str(parsed)
    if key in ALLOW:
        raise ValueError("cart is already registered for this run")
    with transaction.atomic():
        cart = Cart.objects.filter(pk=parsed).first()
        if cart is None:
            raise ValueError("cart was not found")
        if cart.created_at <= STARTED:
            raise ValueError("cart was not created after this run started")
        if cart.user_id is not None:
            raise ValueError("cart has an authenticated user")
        if cart.guest_session_id is None:
            raise ValueError("cart has no guest session")
        session = GuestSession.objects.filter(pk=cart.guest_session_id).first()
        if session is None or session.created_at <= STARTED:
            raise ValueError("guest session was not created after this run started")
        if order_refers(cart.pk, session):
            raise ValueError("an order refers to this cart or session")
        ALLOW[key] = {
            "cart_id": cart.pk,
            "session_id": str(session.pk),
            "token_hash": session.token_hash,
            "expires_at": session.expires_at,
            "revoked_at": session.revoked_at,
        }
        item_count = cart.items.count()
    return {
        "ok": True,
        "item_count": item_count,
        "user_null": True,
        "orders": 0,
        "expired": False,
        "revoked": session.revoked_at is not None,
    }


def expire(cart_id):
    parsed, registered = load_registered(cart_id)
    with transaction.atomic():
        cart, session = guarded_cart(parsed, registered)
        if session.expires_at <= timezone.now():
            raise ValueError("session is already expired")
        if session.revoked_at is not None:
            raise ValueError("session is already revoked")
        session.expires_at = timezone.now() - timedelta(seconds=5)
        session.save(update_fields=["expires_at"])
    return {"ok": True, "action": "expire"}


def revoke(cart_id):
    parsed, registered = load_registered(cart_id)
    with transaction.atomic():
        cart, session = guarded_cart(parsed, registered)
        if session.revoked_at is not None:
            raise ValueError("session is already revoked")
        if session.expires_at <= timezone.now():
            raise ValueError("session is already expired")
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at"])
    return {"ok": True, "action": "revoke"}


def delete_cart(cart_id):
    parsed, registered = load_registered(cart_id)
    with transaction.atomic():
        cart, session = guarded_cart(parsed, registered)
        if session.revoked_at is not None or session.expires_at <= timezone.now():
            raise ValueError("session is not an active credential")
        cart.delete()
        remains = GuestSession.objects.filter(pk=session.pk).exists()
    return {"ok": True, "action": "delete_cart", "session_remains": remains}


def verify(cart_id):
    parsed, registered = load_registered(cart_id)
    with transaction.atomic():
        cart = Cart.objects.filter(pk=parsed).first()
        session = GuestSession.objects.filter(pk=registered["session_id"]).first()
        if session is not None and order_refers(parsed, session):
            raise ValueError("an order refers to this cart or session")
        return public_record(cart, session, registered)


def summary():
    cart_ids = list(ALLOW)
    session_ids = [entry["session_id"] for entry in ALLOW.values()]
    return {
        "ok": True,
        "registered": len(cart_ids),
        "carts_remaining": Cart.objects.filter(pk__in=cart_ids).count() if cart_ids else 0,
        "sessions_remaining": GuestSession.objects.filter(pk__in=session_ids).count() if session_ids else 0,
        "backup": BACKUP,
    }


def handle(request):
    global STARTED, RUN_ID
    action = request.get("action")
    if action == "begin":
        if STARTED is not None:
            raise ValueError("this fixture run has already begun")
        problem = database_ready()
        if problem:
            raise ValueError(problem)
        backup = backup_database()
        STARTED = timezone.now()
        RUN_ID = str(uuid.uuid4())
        return {"ok": True, "run_id": RUN_ID, "started_at": STARTED.isoformat(), "backup": backup}
    if STARTED is None:
        raise ValueError("fixture run has not begun")
    if action == "register":
        return register(request.get("cart_id"))
    if action == "expire":
        return expire(request.get("cart_id"))
    if action == "revoke":
        return revoke(request.get("cart_id"))
    if action == "delete_cart":
        return delete_cart(request.get("cart_id"))
    if action == "verify":
        return verify(request.get("cart_id"))
    if action == "summary":
        return summary()
    raise ValueError("unsupported fixture action")


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        request = {}
        try:
            request = json.loads(line)
            response = handle(request)
        except Exception as exc:
            response = {"ok": False, "error": safe_error(exc)}
        if isinstance(request, dict) and "id" in request:
            response["id"] = request["id"]
        emit(response)


if __name__ == "__main__":
    main()
