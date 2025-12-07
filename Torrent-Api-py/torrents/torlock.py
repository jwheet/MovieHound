import asyncio
import re
import time
import aiohttp
from bs4 import BeautifulSoup
from helper.asyncioPoliciesFix import decorator_asyncio_fix
from helper.html_scraper import Scraper
from constants.base_url import TORLOCK
from constants.headers import HEADER_AIO


class Torlock:
    _name = "Tor Lock"
    def __init__(self):
        self.BASE_URL = TORLOCK
        self.LIMIT = None

    @decorator_asyncio_fix
    async def _individual_scrap(self, session, url, obj):
        try:
            # Add timeout to individual requests
            async with session.get(url, headers=HEADER_AIO, timeout=aiohttp.ClientTimeout(total=10)) as res:
                html = await res.text(encoding="ISO-8859-1")
                soup = BeautifulSoup(html, "html.parser")

                try:
                    # Pattern-based extraction instead of hardcoded indices
                    all_links = soup.find_all("a")
                    magnet = ""
                    torrent = ""
                    category = ""

                    for link in all_links:
                        href = link.get("href", "")

                        if href.startswith("magnet:") and not magnet:
                            magnet = href
                        elif (".torrent" in href or "/download/" in href) and not torrent:
                            torrent = href
                        elif ("/cat/" in href or "/category/" in href) and not category:
                            category = link.text.strip()

                    # Validate we got required data
                    if magnet and str(magnet).startswith("magnet") and torrent:
                        obj["torrent"] = torrent
                        obj["magnet"] = magnet

                        # Extract hash
                        hash_match = re.search(r"([{a-f\d,A-F\d}]{32,40})\b", magnet)
                        if hash_match:
                            obj["hash"] = hash_match.group(0)

                        if category:
                            obj["category"] = category

                        # Extract poster
                        try:
                            poster_img = soup.find("img", class_="img-responsive")
                            if poster_img:
                                obj["poster"] = poster_img.get("src", "")
                        except:
                            pass

                        # Extract screenshots
                        try:
                            screenshot_imgs = soup.select(".tab-content img.img-fluid")
                            if screenshot_imgs:
                                obj["screenshot"] = [img.get("src", "") for img in screenshot_imgs if img.get("src")]
                        except:
                            pass
                    else:
                        print(f"[TORLOCK] Failed to extract valid data from {url}")

                except Exception as e:
                    print(f"[TORLOCK] Error parsing individual page: {e}")

        except asyncio.TimeoutError:
            print(f"[TORLOCK] Timeout fetching {url}")
        except Exception as e:
            print(f"[TORLOCK] Failed to fetch {url}: {e}")

    async def _get_torrent(self, result, session, urls):
        tasks = []
        for idx, url in enumerate(urls):
            for obj in result["data"]:
                if obj["url"] == url:
                    task = asyncio.create_task(
                        self._individual_scrap(session, url, result["data"][idx])
                    )
                    tasks.append(task)

        # Handle partial failures gracefully
        await asyncio.gather(*tasks, return_exceptions=True)
        return result

    def _parser(self, htmls, idx=0):
        try:
            for html in htmls:
                soup = BeautifulSoup(html, "html.parser")
                list_of_urls = []
                my_dict = {"data": []}

                for tr in soup.find_all("tr")[idx:]:
                    td = tr.find_all("td")
                    if len(td) == 0:
                        continue
                    name = td[0].get_text(strip=True)
                    if name != "":
                        url = td[0].find("a")["href"]
                        if url == "":
                            break
                        url = self.BASE_URL + url
                        list_of_urls.append(url)
                        size = td[2].get_text(strip=True)
                        date = td[1].get_text(strip=True)
                        seeders = td[3].get_text(strip=True)
                        leechers = td[4].get_text(strip=True)
                        my_dict["data"].append(
                            {
                                "name": name,
                                "size": size,
                                "date": date,
                                "seeders": seeders,
                                "leechers": leechers,
                                "url": url,
                            }
                        )
                    if len(my_dict["data"]) == self.LIMIT:
                        break
                try:
                    ul = soup.find("ul", class_="pagination")
                    tpages = ul.find_all("a")[-2].text
                    current_page = (
                        (ul.find("li", class_="active")).find("span").text.split(" ")[0]
                    )
                    my_dict["current_page"] = int(current_page)
                    my_dict["total_pages"] = int(tpages)
                except:
                    my_dict["current_page"] = None
                    my_dict["total_pages"] = None
                return my_dict, list_of_urls
        except:
            return None, None

    async def search(self, query, page, limit):
        # Add session-level timeout
        timeout = aiohttp.ClientTimeout(total=60, connect=10, sock_read=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            start_time = time.time()
            self.LIMIT = limit
            url = self.BASE_URL + "/all/torrents/{}.html?sort=seeds&page={}".format(
                query, page
            )
            return await self.parser_result(start_time, url, session, idx=5)

    async def parser_result(self, start_time, url, session, idx=0):
        htmls = await Scraper().get_all_results(session, url)
        result, urls = self._parser(htmls, idx)
        if result is not None:
            results = await self._get_torrent(result, session, urls)
            results["time"] = time.time() - start_time
            results["total"] = len(results["data"])
            return results
        return result

    async def trending(self, category, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            if not category:
                url = self.BASE_URL
            else:
                if category == "books":
                    category = "ebooks"
                url = self.BASE_URL + "/{}.html".format(category)
            return await self.parser_result(start_time, url, session)

    async def recent(self, category, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            if not category:
                url = self.BASE_URL + "/fresh.html"
            else:
                if category == "books":
                    category = "ebooks"
                url = self.BASE_URL + "/{}/{}/added/desc.html".format(category, page)
            return await self.parser_result(start_time, url, session)

    #! Maybe impelment Search By Category in Future
