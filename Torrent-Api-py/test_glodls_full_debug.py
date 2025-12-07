import asyncio
import aiohttp
from bs4 import BeautifulSoup
from constants.headers import HEADER_AIO

async def test_full_flow():
    """Test complete flow with debugging"""

    url = "https://glodls.to/search.php?search=ubuntu&cat=0"

    async with aiohttp.ClientSession() as session:
        print(f"Fetching: {url}")

        try:
            timeout = aiohttp.ClientTimeout(total=30, connect=10, sock_read=20)
            async with session.get(url, headers=HEADER_AIO, timeout=timeout) as r:
                print(f"Status: {r.status}")

                # Read raw bytes
                raw_bytes = await r.read()
                print(f"Raw bytes: {len(raw_bytes)}")

                # Decode latin-1
                html = raw_bytes.decode('latin-1')
                print(f"Decoded HTML: {len(html)} chars")

                # Parse
                soup = BeautifulSoup(html, "html.parser")
                rows = soup.find_all("tr", class_="t-row")[0:-1:2]
                print(f"Found {len(rows)} result rows")

                # Parse first 3
                results = []
                for idx, tr in enumerate(rows[:3]):
                    try:
                        td = tr.find_all("td")
                        if len(td) < 8:
                            print(f"Row {idx}: Not enough td elements ({len(td)})")
                            continue

                        name = td[1].find_all("a")[-1].find("b").text
                        size = td[4].text.strip()
                        seeders = td[5].find("font").find("b").text
                        leechers = td[6].find("font").find("b").text
                        magnet = td[3].find("a")["href"]

                        print(f"\nResult {idx+1}:")
                        print(f"  Name: {name}")
                        print(f"  Size: {size}")
                        print(f"  Seeds: {seeders}")
                        print(f"  Leeches: {leechers}")
                        print(f"  Magnet: {magnet[:80]}...")

                        results.append({
                            "name": name,
                            "size": size,
                            "seeders": seeders,
                            "leechers": leechers,
                            "magnet": magnet
                        })

                    except Exception as e:
                        print(f"Row {idx}: Parse error - {e}")

                print(f"\n✓ Successfully parsed {len(results)} results!")
                return results

        except Exception as e:
            print(f"✗ Error: {e}")
            import traceback
            traceback.print_exc()
            return None

if __name__ == "__main__":
    asyncio.run(test_full_flow())
