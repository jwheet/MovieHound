import time
import asyncio
import aiohttp
from bs4 import BeautifulSoup
from helper.html_scraper import Scraper
from helper.asyncioPoliciesFix import decorator_asyncio_fix
from constants.base_url import GLODLS
from constants.headers import HEADER_AIO


class Glodls:
    _name = "Glodls"
    def __init__(self):
        self.BASE_URL = GLODLS
        self.LIMIT = None

    @decorator_asyncio_fix
    async def _get_html_with_encoding(self, session, url):
        """Custom HTML fetcher that handles latin-1 encoding for Glodls"""
        print(f"[GLODLS] Fetching URL: {url}")
        try:
            timeout = aiohttp.ClientTimeout(total=30, connect=10, sock_read=20)
            async with session.get(url, headers=HEADER_AIO, timeout=timeout) as r:
                print(f"[GLODLS] Response status: {r.status}")
                # Read raw bytes first
                raw_bytes = await r.read()
                print(f"[GLODLS] Read {len(raw_bytes)} bytes")
                # Decode with latin-1 (the actual encoding Glodls uses)
                try:
                    html = raw_bytes.decode('latin-1')
                    print(f"[GLODLS] Successfully decoded {len(html)} chars")
                    return html
                except Exception as de:
                    print(f"[GLODLS] Latin-1 decode failed: {de}, trying UTF-8")
                    # Fallback to UTF-8 if latin-1 fails
                    return raw_bytes.decode('utf-8', errors='ignore')
        except asyncio.TimeoutError:
            print(f"[GLODLS] Timeout fetching {url}")
            return None
        except Exception as e:
            print(f"[GLODLS] Error fetching {url}: {e}")
            import traceback
            traceback.print_exc()
            return None

    async def _get_all_results_custom(self, session, url):
        """Custom result fetcher using latin-1 encoding"""
        html = await self._get_html_with_encoding(session, url)
        return [html] if html else []

    def _parser(self, htmls, query=None):
        try:
            print(f"[GLODLS] Parser received {len(htmls) if htmls else 0} HTML documents")
            if query:
                print(f"[GLODLS] Will filter results for query: '{query}'")

            if not htmls:
                print("[GLODLS] htmls is empty or None")
                return None

            for html in htmls:
                if not html:
                    print("[GLODLS] No HTML received in this iteration")
                    return None

                print(f"[GLODLS] Processing HTML of length {len(html)}")

                soup = BeautifulSoup(html, "html.parser")
                my_dict = {"data": []}

                rows = soup.find_all("tr", class_="t-row")[0:-1:2]
                print(f"[GLODLS] Found {len(rows)} result rows")

                for tr in rows:
                    try:
                        td = tr.find_all("td")
                        if len(td) < 8:
                            continue

                        name = td[1].find_all("a")[-1].find("b").text
                        url = td[1].find_all("a")[-1]["href"]
                        torrent = td[2].find("a")["href"]
                        magnet = td[3].find("a")["href"]
                        size = td[4].text.strip()
                        seeders = td[5].find("font").find("b").text
                        leechers = td[6].find("font").find("b").text
                        try:
                            uploader = td[7].find("a").find("b").find("font").text
                        except:
                            uploader = "Anonymous"

                        # Filter by query if provided
                        if query:
                            # Case-insensitive substring match
                            if query.lower() not in name.lower():
                                continue  # Skip this result

                        my_dict["data"].append(
                            {
                                "name": name,
                                "size": size,
                                "uploader": uploader,
                                "seeders": seeders,
                                "leechers": leechers,
                                "magnet": magnet,
                                "torrent": self.BASE_URL + torrent,
                                "url": self.BASE_URL + url,
                            }
                        )

                        if len(my_dict["data"]) == self.LIMIT:
                            break
                    except Exception as e:
                        print(f"[GLODLS] Failed to parse row: {e}")
                        continue

                # Pagination
                try:
                    pagination = soup.find("div", class_="pagination")
                    if pagination:
                        total_pages = pagination.find_all("a")[-2]["href"]
                        total_pages = total_pages.split("=")[-1]
                        my_dict["total_pages"] = int(total_pages) + 1
                    else:
                        my_dict["total_pages"] = 1
                except:
                    my_dict["total_pages"] = 1

                my_dict["current_page"] = 1
                return my_dict
        except Exception as e:
            print(f"[GLODLS] Critical parser error: {e}")
            import traceback
            traceback.print_exc()
            return None

    async def search(self, query, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            # Use browse.php as fallback - search.php heavily rate-limited
            # Browse returns recent/popular torrents sorted by seeders
            # We'll filter client-side for the query term
            url = self.BASE_URL + "/browse.php"
            print(f"[GLODLS] Using browse.php (search.php rate-limited), will filter for: {query}")
            return await self.parser_result(start_time, url, session, query)

    async def parser_result(self, start_time, url, session, query=None):
        # Use custom encoding-aware fetcher instead of default Scraper
        html = await self._get_all_results_custom(session, url)
        results = self._parser(html, query)
        if results is not None:
            results["time"] = time.time() - start_time
            results["total"] = len(results["data"])
            return results
        return results

    async def trending(self, category, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            url = self.BASE_URL + "/today.php"
            return await self.parser_result(start_time, url, session)

    async def recent(self, category, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            url = self.BASE_URL + "/search.php"
            return await self.parser_result(start_time, url, session)
