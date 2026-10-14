"""Copy to checko_runtime_config.py and configure before starting the stack.

The local configuration is ignored by Git. Proxy addresses may contain credentials:
use the format username:password@host:port in the local file only.
"""

USER_AGENTS_PROXY_LIST = {
    "ip": [],  # Add the proxy addresses used by your environment.
    "user-agent": [
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ],
}

# Example industry selection; replace with the OKVED codes you need.
TARGET_OKVED_CODES = ["62.01"]
