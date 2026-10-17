from app.crypto import decrypt_stock, encrypt_stock, parse_key, stock_fingerprint

DEV_KEY = "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE="
# Produced by packages/shared/src/crypto.ts (encryptStock) — proves TS -> Python compatibility
TS_VECTOR = "8sHDcBfkyWre1H0PE5FMODF9nWMCsD+vC1x4Y8TlnHiC7jkEDXH6rfUcBRTeRy10ds4="


def test_decrypts_ts_payload():
    assert decrypt_stock(TS_VECTOR, parse_key(DEV_KEY)) == "ABCDE-12345-ФЫВАП"


def test_roundtrip():
    key = parse_key(DEV_KEY)
    assert decrypt_stock(encrypt_stock("hello", key), key) == "hello"


def test_fingerprint_matches_ts():
    # sha256("ABC") — same algorithm as stockFingerprint() in TS
    assert stock_fingerprint(" ABC ") == "b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78"
