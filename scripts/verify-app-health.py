#!/usr/bin/env python3
"""
Cyraops Company OS — Automated Application Health & API Sign-Off Engine
Validates server listener, public health endpoint, auth protection, and authenticated endpoints.
Zero exposure of cookies, passwords, or tokens.
"""

import sys
import json
import getpass
import argparse
import urllib.request
import urllib.error
import http.client

BASE_URL = "http://localhost:3001"

def check_health_endpoint() -> bool:
    url = f"{BASE_URL}/api/health"
    print(f"[HEALTH CHECK] Testing {url}...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CyraopsHealthCheck/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            status = resp.status
            if status != 200:
                print(f"[HEALTH ERROR] Expected status 200, got {status}", file=sys.stderr)
                return False
            body = json.loads(resp.read().decode("utf-8"))
            if body.get("status") != "ok" or body.get("database") != "connected":
                print(f"[HEALTH ERROR] Unexpected body content: {body}", file=sys.stderr)
                return False
            print(f"[HEALTH SUCCESS] /api/health returned 200 OK with connected database: {body}")
            return True
    except Exception as exc:
        print(f"[HEALTH ERROR] Request failed: {exc.__class__.__name__}: {exc}", file=sys.stderr)
        return False

def check_login_page() -> bool:
    url = f"{BASE_URL}/login"
    print(f"[PAGE CHECK] Testing public login page at {url}...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CyraopsHealthCheck/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 200:
                print(f"[PAGE SUCCESS] /login returned 200 OK.")
                return True
            print(f"[PAGE ERROR] Expected status 200, got {resp.status}", file=sys.stderr)
            return False
    except Exception as exc:
        print(f"[PAGE ERROR] Request to /login failed: {exc.__class__.__name__}: {exc}", file=sys.stderr)
        return False

def check_unauthenticated_protection() -> bool:
    url = f"{BASE_URL}/api/workspace"
    print(f"[AUTH GATE CHECK] Testing unauthenticated protection on {url}...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CyraopsHealthCheck/1.0"})
        urllib.request.urlopen(req, timeout=5)
        print("[AUTH GATE ERROR] Expected 401 Unauthorized, but endpoint responded with 200 OK!", file=sys.stderr)
        return False
    except urllib.error.HTTPError as err:
        if err.code == 401:
            print("[AUTH GATE SUCCESS] /api/workspace correctly returned 401 Unauthorized for unauthenticated request.")
            return True
        print(f"[AUTH GATE ERROR] Unexpected HTTP status: {err.code}", file=sys.stderr)
        return False
    except Exception as exc:
        print(f"[AUTH GATE ERROR] Request failed: {exc.__class__.__name__}: {exc}", file=sys.stderr)
        return False

def check_authenticated_endpoints_secure(cookie: str) -> bool:
    """
    Validates authenticated endpoints using a provided cookie.
    Guarantees cookie is never printed, logged, or included in error traces.
    Releases cookie Python reference immediately after testing.
    """
    print("[AUTH ENDPOINTS] Testing authenticated APIs using provided session...")
    endpoints = [
        ("/api/workspace", "workspace"),
        ("/api/crm/stats", "currency"),
        ("/api/dashboard", "projects"),
    ]

    all_passed = True
    try:
        for path, expected_key in endpoints:
            url = f"{BASE_URL}{path}"
            try:
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "CyraopsHealthCheck/1.0",
                        "Cookie": f"company_session={cookie}",
                        "Origin": BASE_URL,
                        "Sec-Fetch-Site": "same-origin"
                    }
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status != 200:
                        print(f"[API ERROR] {path} returned HTTP status {resp.status} (expected 200)", file=sys.stderr)
                        all_passed = False
                        continue
                    body = json.loads(resp.read().decode("utf-8"))
                    if expected_key not in body:
                        print(f"[API ERROR] {path} missing expected key '{expected_key}' in response JSON.", file=sys.stderr)
                        all_passed = False
                        continue
                    print(f"[API SUCCESS] {path} returned 200 OK with verified JSON structure (key '{expected_key}').")
            except urllib.error.HTTPError as http_err:
                print(f"[API ERROR] {path} failed with HTTP {http_err.code} (auth rejected or invalid session).", file=sys.stderr)
                all_passed = False
            except Exception as exc:
                print(f"[API ERROR] {path} request failed: {exc.__class__.__name__}", file=sys.stderr)
                all_passed = False
    finally:
        # Release local Python reference to the session cookie string
        del cookie

    return all_passed

def main():
    parser = argparse.ArgumentParser(
        description="Cyraops Application Health & API Sign-Off Engine"
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--unauthenticated-only",
        action="store_true",
        help="Run only public health, page checks, and auth-gate protection tests (default for automated runbooks)"
    )
    group.add_argument(
        "--interactive-auth",
        action="store_true",
        help="Securely prompt operator for Owner session cookie via hidden input (getpass) to test authenticated APIs"
    )

    args = parser.parse_args()

    print("==============================================================================")
    print("CYRAOPS STAGE 12 APPLICATION HEALTH & API VERIFICATION")
    print("==============================================================================")

    # 1. Health endpoint test
    health_ok = check_health_endpoint()
    if not health_ok:
        sys.exit(1)

    # 2. Public login page test
    login_ok = check_login_page()
    if not login_ok:
        sys.exit(1)

    # 3. Auth gate test
    gate_ok = check_unauthenticated_protection()
    if not gate_ok:
        sys.exit(1)

    auth_ok = None
    if args.interactive_auth:
        print("\n[SECURE INPUT] Testing authenticated endpoints requires Owner session.")
        print("[SECURE INPUT] Note: Input will be completely hidden. Cookie is never logged or written to disk.")
        try:
            raw_cookie = getpass.getpass("Enter Owner company_session cookie value (input hidden): ")
            clean_cookie = raw_cookie.strip()
            # Cleanly wipe raw string reference
            del raw_cookie
            if not clean_cookie:
                print("[AUTH ERROR] Empty session cookie provided. Aborting authenticated checks.", file=sys.stderr)
                auth_ok = False
            else:
                auth_ok = check_authenticated_endpoints_secure(clean_cookie)
                del clean_cookie
        except (KeyboardInterrupt, EOFError):
            print("\n[AUTH ABORTED] Interactive input cancelled by operator.")
            auth_ok = False
    else:
        print("[AUTH NOTE] Running in unauthenticated mode. Authenticated API checks deferred to operator.")

    print("\n------------------------------------------------------------------------------")
    print("STAGE 12 HEALTH SIGN-OFF SUMMARY:")
    print(f"  1. Server Process Running:            PASSED (listening on port 3001)")
    print(f"  2. Public /api/health Endpoint:       {'PASSED (200 OK, db connected)' if health_ok else 'FAILED'}")
    print(f"  3. Public /login Page:                {'PASSED (200 OK)' if login_ok else 'FAILED'}")
    print(f"  4. API Security & Auth Gates:         {'PASSED (401 Unauthorized enforced)' if gate_ok else 'FAILED'}")
    if auth_ok is True:
        print("  5. Authenticated /api/workspace:      PASSED (200 OK)")
        print("  6. Authenticated /api/crm/stats:      PASSED (200 OK)")
        print("  7. Authenticated /api/dashboard:      PASSED (200 OK)")
    elif auth_ok is False:
        print("  5-7. Authenticated Endpoints:         FAILED")
    else:
        print("  5-7. Authenticated Endpoints:         PENDING (requires operator credentials via --interactive-auth)")
    print("  8. Manual Browser UI Inspection:      PENDING HUMAN OPERATOR CHECK")
    print("------------------------------------------------------------------------------")

    if not health_ok or not login_ok or not gate_ok or (auth_ok is False):
        sys.exit(1)

if __name__ == "__main__":
    main()
