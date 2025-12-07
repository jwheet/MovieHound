import os
import asyncio
import aiohttp
from .asyncioPoliciesFix import decorator_asyncio_fix
from constants.headers import HEADER_AIO

HTTP_PROXY = os.environ.get("HTTP_PROXY", None)

# Default timeout configuration
DEFAULT_TIMEOUT = aiohttp.ClientTimeout(
    total=30,      # Total timeout for entire request
    connect=10,    # Timeout for connection establishment
    sock_read=20   # Timeout for reading data
)


class Scraper:
    @decorator_asyncio_fix
    async def _get_html(self, session, url, timeout=None):
        try:
            timeout_config = timeout or DEFAULT_TIMEOUT
            async with session.get(url, headers=HEADER_AIO, proxy=HTTP_PROXY, timeout=timeout_config) as r:
                return await r.text()
        except asyncio.TimeoutError:
            print(f"[SCRAPER] Timeout fetching {url}")
            return None
        except aiohttp.ClientError as e:
            print(f"[SCRAPER] Client error fetching {url}: {e}")
            return None
        except Exception as e:
            print(f"[SCRAPER] Error fetching {url}: {e}")
            return None

    async def get_all_results(self, session, url, timeout=None):
        return await asyncio.gather(asyncio.create_task(self._get_html(session, url, timeout)))
