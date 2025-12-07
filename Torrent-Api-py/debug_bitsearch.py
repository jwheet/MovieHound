import asyncio
import aiohttp
from constants.headers import HEADER_AIO

async def fetch_bitsearch_html():
    """Fetch current HTML from bitsearch.to for analysis"""
    url = "https://bitsearch.to/search?q=ubuntu&page=1"

    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=HEADER_AIO) as response:
            html = await response.text()

            # Save to file
            with open("bitsearch_current.html", "w") as f:
                f.write(html)

            print(f"Saved HTML ({len(html)} bytes) to bitsearch_current.html")
            print(f"Status: {response.status}")
            return html

if __name__ == "__main__":
    asyncio.run(fetch_bitsearch_html())
