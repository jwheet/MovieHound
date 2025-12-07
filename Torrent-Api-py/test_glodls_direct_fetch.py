import asyncio
import aiohttp
from constants.headers import HEADER_AIO

async def test_fetch():
    url = "https://glodls.to/search_results.php?search=ubuntu&cat=0&incldead=0&inclexternal=0&lang=0&sort=seeders&order=desc&page=0"

    async with aiohttp.ClientSession() as session:
        try:
            timeout = aiohttp.ClientTimeout(total=30, connect=10, sock_read=20)
            async with session.get(url, headers=HEADER_AIO, timeout=timeout) as r:
                print(f"Status: {r.status}")
                print(f"Content-Type: {r.headers.get('Content-Type')}")

                # Read raw bytes
                raw_bytes = await r.read()
                print(f"Raw bytes length: {len(raw_bytes)}")

                # Try latin-1
                try:
                    html = raw_bytes.decode('latin-1')
                    print(f"✓ Decoded with latin-1, length: {len(html)}")
                    print(f"First 300 chars: {html[:300]}")

                    # Check for t-row
                    if "t-row" in html:
                        print("✓ Found 't-row' in HTML")
                        count = html.count('class="t-row"') + html.count("class='t-row'")
                        print(f"  Found {count} instances of t-row class")
                    else:
                        print("✗ 't-row' not found in HTML")

                except Exception as e:
                    print(f"✗ Failed to decode: {e}")

        except Exception as e:
            print(f"✗ Error fetching: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_fetch())
