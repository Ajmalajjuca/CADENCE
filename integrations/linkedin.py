"""
LinkedIn API integration.

Uses the UGC Posts API (v2) to publish text posts to the user's profile.

Setup required:
1. Create a LinkedIn Developer App at https://www.linkedin.com/developers/
2. Add the "Share on LinkedIn" product (gives w_member_social permission)
3. Generate an access token (valid for 60 days — you'll need to refresh periodically)
4. Get your Person URN by calling GET https://api.linkedin.com/v2/me
5. Add LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN to your .env file
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

_API_BASE = "https://api.linkedin.com/v2"


def _headers() -> dict:
    token = os.getenv("LINKEDIN_ACCESS_TOKEN")
    if not token:
        raise EnvironmentError(
            "LINKEDIN_ACCESS_TOKEN not set. Add it to your .env file.\n"
            "See .env.example for setup instructions."
        )
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
    }


def post(text: str) -> dict:
    """
    Publish a text post to LinkedIn.

    Args:
        text: The post text (plain text, no HTML)

    Returns:
        Dict with "post_url" key, or raises on failure
    """
    person_urn = os.getenv("LINKEDIN_PERSON_URN")
    if not person_urn:
        raise EnvironmentError(
            "LINKEDIN_PERSON_URN not set. Add it to your .env file.\n"
            "Format: urn:li:person:XXXXXXXX\n"
            "Find it via: GET https://api.linkedin.com/v2/me"
        )

    payload = {
        "author": person_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        },
    }

    response = requests.post(
        f"{_API_BASE}/ugcPosts",
        headers=_headers(),
        json=payload,
        timeout=30,
    )

    if response.status_code not in (200, 201):
        raise RuntimeError(
            f"LinkedIn API error {response.status_code}: {response.text}"
        )

    # LinkedIn returns the post ID in the X-RestLi-Id header
    post_id = response.headers.get("X-RestLi-Id", "")
    post_url = f"https://www.linkedin.com/feed/update/{post_id}/" if post_id else "Published (URL unavailable)"

    return {"post_url": post_url, "post_id": post_id}
