import re
import time
import aiohttp
from bs4 import BeautifulSoup
from helper.html_scraper import Scraper
from constants.base_url import BITSEARCH


class Bitsearch:
    _name = "Bit Search"
    def __init__(self):
        self.BASE_URL = BITSEARCH
        self.LIMIT = None

    def _parser(self, htmls):
        try:
            for html in htmls:
                soup = BeautifulSoup(html, "html.parser")
                my_dict = {"data": []}

                # Find all search result divs (new structure uses Tailwind CSS)
                result_divs = soup.find_all("div", class_="bg-white rounded-lg shadow-sm border border-gray-200 p-6".split())

                if not result_divs:
                    print("[BITSEARCH] No search results found")
                    return {"data": [], "current_page": 1, "total_pages": 1}

                for div in result_divs:
                    try:
                        # Extract title and URL
                        title_h3 = div.find("h3", class_=lambda x: x and "text-gray-900" in x and "line-clamp-2" in x)
                        if not title_h3:
                            continue

                        title_link = title_h3.find("a")
                        if not title_link:
                            continue

                        name = title_link.text.strip()
                        url = title_link.get("href", "")

                        # Extract category (icon: fas fa-video)
                        category = "Unknown"
                        category_span = div.find("i", class_=lambda x: x and "fa-video" in x)
                        if category_span:
                            category_text = category_span.find_next("span")
                            if category_text:
                                category = category_text.text.strip()

                        # Extract size (icon: fas fa-download)
                        size = "Unknown"
                        size_icon = div.find("i", class_=lambda x: x and "fa-download" in x)
                        if size_icon:
                            size_text = size_icon.find_next("span")
                            if size_text:
                                size = size_text.text.strip()

                        # Extract date (icon: fas fa-calendar)
                        date = "Unknown"
                        date_icon = div.find("i", class_=lambda x: x and "fa-calendar" in x)
                        if date_icon:
                            date_text = date_icon.find_next("span")
                            if date_text:
                                date = date_text.text.strip()

                        # Extract seeders (text-green-600)
                        seeders = "0"
                        seeders_span = div.find("span", class_=lambda x: x and "text-green-600" in x)
                        if seeders_span:
                            seeders_num = seeders_span.find("span", class_="font-medium")
                            if seeders_num:
                                seeders = seeders_num.text.strip()

                        # Extract leechers (text-red-600)
                        leechers = "0"
                        leechers_span = div.find("span", class_=lambda x: x and "text-red-600" in x)
                        if leechers_span:
                            leechers_num = leechers_span.find("span", class_="font-medium")
                            if leechers_num:
                                leechers = leechers_num.text.strip()

                        # Extract magnet and torrent links
                        magnet = ""
                        torrent = ""

                        for link in div.find_all("a"):
                            href = link.get("href", "")
                            if href.startswith("magnet:"):
                                magnet = href
                            elif "/download/torrent/" in href:
                                # Convert relative URL to full URL
                                torrent = self.BASE_URL + href

                        if not magnet:
                            continue

                        # Extract hash from magnet
                        hash_match = re.search(r"([{a-f\d,A-F\d}]{32,40})\b", magnet)
                        if not hash_match:
                            continue

                        my_dict["data"].append({
                            "name": name,
                            "size": size,
                            "seeders": seeders,
                            "leechers": leechers,
                            "category": category,
                            "hash": hash_match.group(0),
                            "magnet": magnet,
                            "torrent": torrent,
                            "url": self.BASE_URL + url if not url.startswith("http") else url,
                            "date": date,
                            "downloads": "N/A"  # Not available in new structure
                        })

                        if len(my_dict["data"]) == self.LIMIT:
                            break

                    except Exception as e:
                        print(f"[BITSEARCH] Failed to parse result: {e}")
                        continue

                # Pagination extraction
                try:
                    pagination = soup.find("nav", attrs={"aria-label": "Pagination"})
                    if pagination:
                        current_page_elem = pagination.find("span", class_=lambda x: x and "bg-primary" in x)
                        current_page = int(current_page_elem.text) if current_page_elem else 1

                        page_links = pagination.find_all("a", href=True)
                        total_pages = 1
                        for link in page_links:
                            try:
                                page_num = int(link.text.strip())
                                if page_num > total_pages:
                                    total_pages = page_num
                            except:
                                continue

                        my_dict["current_page"] = current_page
                        my_dict["total_pages"] = total_pages
                    else:
                        my_dict["current_page"] = 1
                        my_dict["total_pages"] = 1
                except:
                    my_dict["current_page"] = 1
                    my_dict["total_pages"] = 1

                return my_dict

        except Exception as e:
            print(f"[BITSEARCH] Critical parser error: {e}")
            import traceback
            traceback.print_exc()
            return None

    async def search(self, query, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            url = self.BASE_URL + "/search?q={}&page={}".format(query, page)
            return await self.parser_result(start_time, url, session)

    async def parser_result(self, start_time, url, session):
        html = await Scraper().get_all_results(session, url)
        results = self._parser(html)
        if results is not None:
            results["time"] = time.time() - start_time
            results["total"] = len(results["data"])
            return results
        return results

    async def trending(self, category, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            url = self.BASE_URL + "/trending"
            return await self.parser_result(start_time, url, session)
