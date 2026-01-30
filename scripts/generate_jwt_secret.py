#!/usr/bin/env python3
"""
Generate a secure random JWT_SECRET for Node-Proxy admin panel.
Usage: python scripts/generate_jwt_secret.py
Output: Copy the line into your .env or Railway Variables.
"""
import secrets

# 32 bytes = 256 bits, hex-encoded = 64 chars
secret = secrets.token_hex(32)
print("# Add to Railway Variables or .env:")
print(f"JWT_SECRET={secret}")
