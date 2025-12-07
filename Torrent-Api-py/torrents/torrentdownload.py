import re
import time
import aiohttp
from bs4 import BeautifulSoup
from helper.html_scraper import Scraper
from constants.base_url import TORRENTDOWNLOAD
from constants.headers import HEADER_AIO

class TorrentDownload:
    """
    Scraper for TorrentDownload.info
    Fast torrent site with good availability
    """
    _name = "TorrentDownload"

    def __init__(self):
        self.BASE_URL = TORRENTDOWNLOAD
        self.LIMIT = None

    def _extract_quality(self, name):
        """Extract quality from torrent name"""
        name_lower = name.lower()

        # Check for common quality indicators in priority order
        if '2160p' in name_lower or '4k' in name_lower or 'uhd' in name_lower:
            return '2160p'
        elif '1080p' in name_lower or 'fullhd' in name_lower or 'fhd' in name_lower:
            return '1080p'
        elif '720p' in name_lower or 'hd' in name_lower:
            return '720p'
        elif '480p' in name_lower or 'dvdrip' in name_lower or 'xvid' in name_lower:
            return '480p'
        elif 'cam' in name_lower or 'ts' in name_lower or 'tc' in name_lower:
            return 'CAM'
        else:
            return 'Unknown'

    def _parser(self, htmls):
        """
        Parse HTML and extract torrent data

        Returns:
            dict: {
                "data": [list of torrents],
                "current_page": int,
                "total_pages": int
            }
        """
        try:
            for html in htmls:
                soup = BeautifulSoup(html, "html.parser")
                my_dict = {"data": []}

                # Find main results table (skip first table which is "Fast Links")
                tables = soup.find_all("table", class_="table2")
                if len(tables) < 2:
                    return {"data": [], "current_page": 1, "total_pages": 1}

                results_table = tables[1]  # Second table contains actual results
                rows = results_table.find_all("tr")[1:]  # Skip header row

                for row in rows:
                    try:
                        cells = row.find_all("td")
                        if len(cells) < 5:
                            continue

                        # Cell structure:
                        # cells[0] = Name with link (hash in href)
                        # cells[1] = Date
                        # cells[2] = Size
                        # cells[3] = Seeders
                        # cells[4] = Leechers

                        # Extract name and URL
                        name_cell = cells[0]
                        name_div = name_cell.find("div", class_="tt-name")
                        if not name_div:
                            continue

                        name_link = name_div.find("a")
                        if not name_link:
                            continue

                        # Get name (remove HTML tags like <span class="na">)
                        name = name_link.get_text(strip=True)

                        # Remove category suffix if present
                        if " » " in name:
                            name = name.split(" » ")[0].strip()

                        # Extract href which contains hash
                        # Format: /HASH/torrent-name
                        href = name_link.get("href", "")
                        if not href or not href.startswith("/"):
                            continue

                        # Extract hash from URL (first part after /)
                        hash_match = re.match(r"/([A-F0-9]{40})/", href)
                        if not hash_match:
                            continue

                        hash_value = hash_match.group(1).lower()

                        # Construct full URL
                        url = self.BASE_URL + href

                        # Extract date
                        date = cells[1].text.strip() if len(cells) > 1 else "N/A"

                        # Extract size
                        size = cells[2].text.strip() if len(cells) > 2 else "N/A"

                        # Extract seeders
                        seeders = cells[3].text.strip() if len(cells) > 3 else "0"
                        seeders = seeders.replace(",", "")  # Remove commas from numbers

                        # Extract leechers
                        leechers = cells[4].text.strip() if len(cells) > 4 else "0"
                        leechers = leechers.replace(",", "")  # Remove commas from numbers

                        # Construct magnet link from hash
                        # Using common trackers for better peer discovery
                        trackers = [
                            "udp://tracker.openbittorrent.com:80/announce",
                            "udp://tracker.opentrackr.org:1337/announce",
                            "udp://tracker.torrent.eu.org:451/announce",
                            "udp://open.stealth.si:80/announce",
                            "udp://tracker.tiny-vps.com:6969/announce"
                        ]

                        tracker_params = "&".join([f"tr={t}" for t in trackers])
                        magnet = f"magnet:?xt=urn:btih:{hash_value.upper()}&dn={name}&{tracker_params}"

                        # Extract category from the name cell
                        category_span = name_div.find("span", class_="smallish")
                        category = "Unknown"
                        if category_span:
                            category_text = category_span.text.strip()
                            if " » " in category_text:
                                category = category_text.split(" » ")[1].strip()

                        # Extract quality from name
                        quality = self._extract_quality(name)

                        # Build result object
                        torrent_data = {
                            "name": name,
                            "size": size,
                            "seeders": seeders,
                            "leechers": leechers,
                            "magnet": magnet,
                            "hash": hash_value,
                            "url": url,
                            "date": date,
                            "category": category,
                            "quality": quality
                        }

                        my_dict["data"].append(torrent_data)

                        # Respect limit
                        if self.LIMIT and len(my_dict["data"]) >= self.LIMIT:
                            break

                    except Exception as e:
                        # Skip individual result errors
                        print(f"[TORRENTDOWNLOAD] Failed to parse row: {e}")
                        continue

                # Handle pagination
                try:
                    pagination = soup.find("div", class_="search_stat")
                    if pagination:
                        # Find active page
                        active_page = pagination.find("span", class_="active")
                        current_page = int(active_page.text) if active_page else 1

                        # Find all page links to determine total pages
                        page_links = pagination.find_all("a", href=re.compile(r"p=\d+"))
                        if page_links:
                            # Extract page numbers from links
                            page_numbers = []
                            for link in page_links:
                                match = re.search(r"p=(\d+)", link.get("href", ""))
                                if match:
                                    page_numbers.append(int(match.group(1)))

                            total_pages = max(page_numbers) if page_numbers else current_page
                        else:
                            total_pages = current_page
                    else:
                        current_page = 1
                        total_pages = 1
                except Exception as e:
                    print(f"[TORRENTDOWNLOAD] Failed to parse pagination: {e}")
                    current_page = 1
                    total_pages = 1

                my_dict["current_page"] = current_page
                my_dict["total_pages"] = total_pages

                return my_dict

        except Exception as e:
            print(f"[TORRENTDOWNLOAD] Parser error: {e}")
            return None

    async def search(self, query, page, limit):
        """
        Search for torrents

        Args:
            query: Search query string
            page: Page number (1-indexed)
            limit: Maximum results to return

        Returns:
            dict: Search results with timing info
        """
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit

            # URL format: /search?q=QUERY&p=PAGE
            url = f"{self.BASE_URL}/search?q={query}&p={page}"

            return await self.parser_result(start_time, url, session)

    async def parser_result(self, start_time, url, session):
        """
        Common method to fetch HTML and parse results
        """
        htmls = await Scraper().get_all_results(session, url)
        result = self._parser(htmls)

        if result is not None:
            result["time"] = time.time() - start_time
            result["total"] = len(result["data"])
            return result

        return result

    async def trending(self, category, page, limit):
        """
        Get trending torrents
        TorrentDownload.info doesn't have a trending page,
        so we'll return top results
        """
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit

            # Use homepage or popular searches
            url = f"{self.BASE_URL}/"

            return await self.parser_result(start_time, url, session)

    async def recent(self, category, page, limit):
        """
        Get recent torrents
        Using date sorted search
        """
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit

            # Sort by date (use searchd endpoint)
            url = f"{self.BASE_URL}/searchd?q=&p={page}"

            return await self.parser_result(start_time, url, session)
