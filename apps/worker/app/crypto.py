"""AES-256-GCM stock encryption — byte-compatible with packages/shared/src/crypto.ts.

Wire format:  base64( iv[12] || tag[16] || ciphertext )   (tag BEFORE ciphertext, no AAD)
Key: STOCK_ENCRYPTION_KEY = 32 bytes as base64 or 64 hex chars.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IV_LEN = 12
TAG_LEN = 16


def parse_key(raw: str) -> bytes:
    raw = raw.strip()
    if not raw:
        raise ValueError("STOCK_ENCRYPTION_KEY is not set")
    key = bytes.fromhex(raw) if re.fullmatch(r"[0-9a-fA-F]{64}", raw) else base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError(f"STOCK_ENCRYPTION_KEY must decode to 32 bytes, got {len(key)}")
    return key


def decrypt_stock(payload_enc: str, key: bytes) -> str:
    raw = base64.b64decode(payload_enc)
    if len(raw) < IV_LEN + TAG_LEN:
        raise ValueError("Invalid stock payload")
    iv, tag, ct = raw[:IV_LEN], raw[IV_LEN : IV_LEN + TAG_LEN], raw[IV_LEN + TAG_LEN :]
    # `cryptography` expects ciphertext || tag
    return AESGCM(key).decrypt(iv, ct + tag, None).decode("utf-8")


def encrypt_stock(plaintext: str, key: bytes) -> str:
    iv = os.urandom(IV_LEN)
    sealed = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), None)  # ct || tag
    ct, tag = sealed[:-TAG_LEN], sealed[-TAG_LEN:]
    return base64.b64encode(iv + tag + ct).decode("ascii")


def stock_fingerprint(plaintext: str) -> str:
    return hashlib.sha256(plaintext.strip().encode("utf-8")).hexdigest()
