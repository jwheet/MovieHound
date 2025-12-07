import re
from bs4 import BeautifulSoup

def complete_parser(html):
    """Complete new parser based on actual website structure"""

    soup = BeautifulSoup(html, "html.parser")
    my_dict = {"data": []}

    # Find all search result divs
    result_divs = soup.find_all("div", class_="bg-white rounded-lg shadow-sm border border-gray-200 p-6".split())

    if not result_divs:
        print("[BITSEARCH] No results found")
        return {"data": [], "current_page": 1, "total_pages": 1}

    print(f"[BITSEARCH] Found {len(result_divs)} results")

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
                    torrent = "https://bitsearch.to" + href

            if not magnet:
                print(f"[BITSEARCH] No magnet for: {name}")
                continue

            # Extract hash from magnet
            hash_match = re.search(r"([{a-f\d,A-F\d}]{32,40})\b", magnet)
            if not hash_match:
                print(f"[BITSEARCH] No hash for: {name}")
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
                "url": "https://bitsearch.to" + url if not url.startswith("http") else url,
                "date": date,
                "downloads": "N/A"  # Not available in new structure
            })

            print(f"[BITSEARCH] Parsed: {name} ({seeders} seeds)")

        except Exception as e:
            print(f"[BITSEARCH] Failed to parse result: {e}")
            import traceback
            traceback.print_exc()
            continue

    # Pagination (if available)
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

if __name__ == "__main__":
    with open("bitsearch_current.html", "r") as f:
        html = f.read()

    result = complete_parser(html)
    print(f"\n=== RESULTS ===")
    print(f"Total results: {len(result['data'])}")
    print(f"Current page: {result['current_page']}")
    print(f"Total pages: {result['total_pages']}")

    if result['data']:
        print(f"\nFirst result:")
        first = result['data'][0]
        for key, value in first.items():
            if key == "magnet":
                print(f"  {key}: {value[:80]}...")
            else:
                print(f"  {key}: {value}")
