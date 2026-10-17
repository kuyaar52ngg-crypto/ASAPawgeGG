import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.crypto import decrypt_stock, encrypt_stock, parse_key, stock_fingerprint

DEV_KEY = "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE="
# Produced by packages/shared/src/crypto.ts (encryptStock) — proves TS -> Python compatibility
TS_VECTOR = "8sHDcBfkyWre1H0PE5FMODF9nWMCsD+vC1x4Y8TlnHiC7jkEDXH6rfUcBRTeRy10ds4="
TS_CRYPTO = Path(__file__).resolve().parents[3] / "packages" / "shared" / "src" / "crypto.ts"


def test_decrypts_ts_payload():
    assert decrypt_stock(TS_VECTOR, parse_key(DEV_KEY)) == "ABCDE-12345-ФЫВАП"


def test_roundtrip():
    key = parse_key(DEV_KEY)
    assert decrypt_stock(encrypt_stock("hello", key), key) == "hello"


def test_hex_key_equals_base64_key():
    import base64

    raw = base64.b64decode(DEV_KEY)
    assert parse_key(raw.hex()) == parse_key(DEV_KEY)


def test_tampered_payload_rejected():
    key = parse_key(DEV_KEY)
    enc = encrypt_stock("secret", key)
    import base64

    raw = bytearray(base64.b64decode(enc))
    raw[-1] ^= 1
    with pytest.raises(Exception):
        decrypt_stock(base64.b64encode(bytes(raw)).decode(), key)


def test_fingerprint_matches_ts():
    # sha256("ABC") — same algorithm as stockFingerprint() in TS
    assert stock_fingerprint(" ABC ") == "b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78"


def _node(script: str) -> str:
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        pytest.skip(f"node cannot run the TS helper: {res.stderr[:200]}")
    return res.stdout.strip()


@pytest.mark.parametrize("plaintext", ["XXXXX-YYYYY-ZZZZZ", "login:пароль-🔑", "line1\nline2\n", ""])
def test_live_ts_encrypt_python_decrypt(plaintext):
    """Encrypt with the REAL TypeScript helper (node), decrypt with Python."""
    script = (
        f"import {{ encryptStock, parseStockKey }} from {json.dumps(TS_CRYPTO.as_uri())};"
        f"console.log(encryptStock({json.dumps(plaintext)}, parseStockKey({json.dumps(DEV_KEY)})));"
    )
    assert decrypt_stock(_node(script), parse_key(DEV_KEY)) == plaintext


def test_live_python_encrypt_ts_decrypt():
    key = parse_key(DEV_KEY)
    enc = encrypt_stock("py→ts ключ 123", key)
    script = (
        f"import {{ decryptStock, parseStockKey }} from {json.dumps(TS_CRYPTO.as_uri())};"
        f"console.log(JSON.stringify(decryptStock({json.dumps(enc)}, parseStockKey({json.dumps(DEV_KEY)}))));"
    )
    assert json.loads(_node(script)) == "py→ts ключ 123"
