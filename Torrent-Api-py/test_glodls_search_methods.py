import asyncio
import aiohttp
from constants.headers import HEADER_AIO

async def test_different_urls():
    """Test different Glodls search URLs"""

    urls_to_test = [
        ("Homepage", "https://glodls.to/"),
        ("Search page cat=1", "https://glodls.to/search.php?cat=1"),
        ("Search page no params", "https://glodls.to/search.php"),
        ("Old search_results", "https://glodls.to/search_results.php?search=ubuntu&cat=0&incldead=0&inclexternal=0&lang=0&sort=seeders&order=desc&page=0"),
        ("Simple search", "https://glodls.to/search.php?search=ubuntu"),
        ("Browse all", "https://glodls.to/browse.php"),
    ]

    async with aiohttp.ClientSession() as session:
        for name, url in urls_to_test:
            try:
                timeout = aiohttp.ClientTimeout(total=15)
                async with session.get(url, headers=HEADER_AIO, timeout=timeout) as r:
                    content = await r.read()
                    status = r.status

                    if status == 200 and len(content) > 1000:
                        # Save working URL
                        html = content.decode('latin-1', errors='ignore')
                        print(f"✓ {name}: HTTP {status}, Size: {len(content)} bytes")

                        # Check for t-row results
                        if 't-row' in html:
                            count = html.count("class='t-row'") + html.count('class="t-row"')
                            print(f"  → Contains {count} t-row results!")

                            # Save this working HTML
                            with open(f"/tmp/glodls_{name.replace(' ', '_')}.html", "w") as f:
                                f.write(html)
                            print(f"  → Saved to /tmp/glodls_{name.replace(' ', '_')}.html")

                        # Check for search form
                        if '<form' in html and 'search' in html.lower():
                            print(f"  → Contains search form")
                            # Extract form action
                            import re
                            forms = re.findall(r'<form[^>]*action=["\']([^"\']+)["\'][^>]*>', html, re.IGNORECASE)
                            if forms:
                                print(f"  → Form actions: {forms[:3]}")
                    else:
                        print(f"✗ {name}: HTTP {status}, Size: {len(content)} bytes")

            except asyncio.TimeoutError:
                print(f"✗ {name}: Timeout")
            except Exception as e:
                print(f"✗ {name}: Error - {e}")

            await asyncio.sleep(2)  # Rate limit

if __name__ == "__main__":
    asyncio.run(test_different_urls())
