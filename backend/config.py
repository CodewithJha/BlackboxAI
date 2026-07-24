import os

PLACEHOLDER_GEMINI_KEYS = {
    "",
    "your-gemini-key-here",
    "your_api_key_here",
    "replace-me",
    "changeme",
}


def has_configured_gemini_api_key() -> bool:
    raw_value = os.getenv("GEMINI_API_KEY", "")
    normalized = raw_value.strip()
    if not normalized:
        return False
    return normalized.lower() not in PLACEHOLDER_GEMINI_KEYS
