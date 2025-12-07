import asyncio
import aiohttp
from constants.headers import HEADER_AIO

async def test_search_queries():
    """Test search.php with different query parameters"""

    test_urls = [
        ("Browse cat=1 (Movies)", "https://glodls.to/search.php?cat=1"),
        ("Search cat=1 ubuntu", "https://glodls.to/search.php?cat=1&search=ubuntu"),
        ("Search cat=0 ubuntu", "https://glodls.to/search.php?cat=0&search=ubuntu"),
        ("Search no cat ubuntu", "https://glodls.to/search.php?search=ubuntu"),
        ("Browse.php", "https://glodls.to/browse.php"),
        ("Browse with query", "https://glodls.to/browse.php?search=ubuntu"),
    ]

    async with aiohttp.ClientSession() as session:
        for name, url in test_urls:
            try:
                timeout = aiohttp.ClientTimeout(total=15)
                async with session.get(url, headers=HEADER_AIO, timeout=timeout) as r:
                    raw = await r.read()
                    status = r.status

                    if status == 200:
                        html = raw.decode('latin-1', errors='ignore')
                        t_row_count = html.count("class='t-row'")

                        print(f"✓ {name}")
                        print(f"  Status: {status}, Size: {len(raw)} bytes")
                        print(f"  t-row results: {t_row_count}")

                        # Check if it has ubuntu in results
                        if 'ubuntu' in html.lower():
                            ubuntu_count = html.lower().count('ubuntu')
                            print(f"  Contains 'ubuntu': {ubuntu_count} times")

                        print()
                    else:
                        print(f"✗ {name}: HTTP {status}\n")

            except Exception as e:
                print(f"✗ {name}: {e}\n")

            await asyncio.sleep(2)

if __name__ == "__main__":
    asyncio.run(test_search_queries())
