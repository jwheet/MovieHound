from bs4 import BeautifulSoup

def test_parser(html):
    """Test the existing Glodls parser logic with saved HTML"""

    soup = BeautifulSoup(html, "html.parser")
    my_dict = {"data": []}

    # Original parser logic from glodls.py
    rows = soup.find_all("tr", class_="t-row")[0:-1:2]  # Every other row, skip last
    print(f"Found {len(rows)} result rows")

    for idx, tr in enumerate(rows[:3]):  # Test first 3
        try:
            td = tr.find_all("td")
            print(f"\n=== Result {idx+1} ===")
            print(f"Number of td elements: {len(td)}")

            if len(td) < 8:
                print(f"Skipping - not enough td elements")
                continue

            # Extract data following original logic
            name = td[1].find_all("a")[-1].find("b").text
            url = td[1].find_all("a")[-1]["href"]
            torrent = td[2].find("a")["href"]
            magnet = td[3].find("a")["href"]
            size = td[4].text
            seeders = td[5].find("font").find("b").text
            leechers = td[6].find("font").find("b").text
            try:
                uploader = td[7].find("a").find("b").find("font").text
            except:
                uploader = "Anonymous"

            print(f"Name: {name}")
            print(f"URL: {url}")
            print(f"Size: {size}")
            print(f"Seeders: {seeders}")
            print(f"Leechers: {leechers}")
            print(f"Uploader: {uploader}")
            print(f"Magnet: {magnet[:80]}...")

            my_dict["data"].append({
                "name": name,
                "size": size,
                "uploader": uploader,
                "seeders": seeders,
                "leechers": leechers,
                "magnet": magnet,
                "torrent": "https://glodls.to" + torrent,
                "url": "https://glodls.to" + url,
            })

        except Exception as e:
            print(f"Error parsing row {idx+1}: {e}")
            import traceback
            traceback.print_exc()

    return my_dict

if __name__ == "__main__":
    with open("glodls_current.html", "r", encoding="utf-8") as f:
        html = f.read()

    result = test_parser(html)
    print(f"\n=== FINAL RESULTS ===")
    print(f"Total parsed: {len(result['data'])}")

    if result['data']:
        print(f"\nFirst result:")
        for key, value in result['data'][0].items():
            if key == "magnet":
                print(f"  {key}: {value[:80]}...")
            else:
                print(f"  {key}: {value}")
