import asyncio
import aiohttp
from constants.headers import HEADER_AIO

async def fetch_glodls_html():
    """Fetch current HTML from glodls.to with proper encoding handling"""
    url = "https://glodls.to/search_results.php?search=ubuntu&cat=0&incldead=0&inclexternal=0&lang=0&sort=seeders&order=desc&page=0"

    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=HEADER_AIO) as response:
            # Get raw bytes first
            raw_bytes = await response.read()

            print(f"Status: {response.status}")
            print(f"Content-Type: {response.headers.get('Content-Type', 'Unknown')}")
            print(f"Raw size: {len(raw_bytes)} bytes")

            # Try different encodings
            encodings = ['utf-8', 'latin-1', 'windows-1252', 'iso-8859-1', 'cp1252']

            html = None
            successful_encoding = None

            for encoding in encodings:
                try:
                    html = raw_bytes.decode(encoding)
                    successful_encoding = encoding
                    print(f"✓ Successfully decoded with {encoding}")
                    break
                except UnicodeDecodeError as e:
                    print(f"✗ Failed with {encoding}: {e}")

            if html:
                # Save to file
                with open("glodls_current.html", "w", encoding="utf-8") as f:
                    f.write(html)

                print(f"\nSaved HTML ({len(html)} chars) to glodls_current.html")
                print(f"Used encoding: {successful_encoding}")

                # Show a snippet
                print(f"\nFirst 500 chars:")
                print(html[:500])
            else:
                print("\n✗ Could not decode with any encoding!")
                # Save raw bytes for inspection
                with open("glodls_raw.bin", "wb") as f:
                    f.write(raw_bytes)
                print("Saved raw bytes to glodls_raw.bin")

            return html, successful_encoding

if __name__ == "__main__":
    asyncio.run(fetch_glodls_html())
