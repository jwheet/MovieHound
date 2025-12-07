<h2 align='center'>Torrents Api ✨</h2>

<p align="center">
<span style='font-size: 19px'>
An Unofficial API for <span style='font-weight:600;'>1337x</span>, <span style='font-weight:600;'>Piratebay</span>, <span style='font-weight:bold;'>Nyaasi</span>, <span style='font-weight:bold;'>Torlock</span>, <span style='font-weight:bold;'>Torrent Galaxy</span>, <span style='font-weight:600;'>Zooqle</span>, <span style='font-weight:600;'>Kickass</span>, <span style='font-weight:600;'>Bitsearch</span>, <span style='font-weight:600;'>MagnetDL, </span>Libgen, YTS, Limetorrent, TorrentFunk, Glodls, TorrentProject and YourBittorrent
</span>
</p>

## Installation

```sh

# Clone the repo
$ git clone https://github.com/author/Torrent-Api-py

# Go to the repository
$ cd Torrent-Api-py

# Install virtualenv
$ pip install virtualenv

# Create Virtual Env
$ py -3 -m venv api-py

# Activate Virtual Env [Windows]
$ .\api-py\Scripts\activate

# Activate Virtual Env [Linux]
$ source api-py/bin/activate

# Install Dependencies
$ pip install -r requirements.txt

# Start
$ python main.py

# (optional) To Use a PROXY, set the HTTP Proxy environment variable
# You can also use a tor proxy using dperson/torproxy:latest
$ export HTTP_PROXY="http://proxy-host:proxy-port"

# To access API Open any browser/API Testing tool & move to the given URL
$ localhost:8009 

```

---

## Supported Sites

|    Website     |     Keyword      |             Url              | Cloudfare |
| :------------: | :--------------: | :--------------------------: | :-------: |
|     1337x      |     `1337x`      |       https://1337x.to       |     ❌     |
| Torrent Galaxy |      `tgx`       |   https://torrentgalaxy.to   |     ❌     |
|    Torlock     |    `torlock`     |   https://www.torlock.com    |     ❌     |
|   PirateBay    |   `piratebay`    |  https://thepiratebay10.org  |     ❌     |
|     Nyaasi     |     `nyaasi`     |       https://nyaa.si        |     ❌     |
|     Zooqle     |     `zooqle`     |      https://zooqle.com      |     ❌     |
|    KickAss     |    `kickass`     |  https://kickasstorrents.to  |     ❌     |
|   Bitsearch    |   `bitsearch`    |     https://bitsearch.to     |     ❌     |
|    MagnetDL    |    `magnetdl`    |   https://www.magnetdl.com   |     ✅     |
|     Libgen     |     `libgen`     |      https://libgen.is       |     ❌     |
|      YTS       |      `yts`       |        https://yts.mx        |     ❌     |
|  Limetorrent   |  `limetorrent`   | https://www.limetorrents.pro |     ❌     |
|  TorrentFunk   |  `torrentfunk`   | https://www.torrentfunk.com  |     ❌     |
|     Glodls     |     `glodls`     |      https://glodls.to       |     ❌     |
| TorrentProject | `torrentproject` | https://torrentproject2.com  |     ❌     |
| YourBittorrent |      `ybt`       |  https://yourbittorrent.com  |     ❌     |

---

<details open>
<summary style='font-size: 20px'><span style='font-size: 25px;font-weight:bold;'>Supported Methods and categories</span></summary>

> If you want to change the default limit site wise [Visit Here](https://github.com/author/Torrent-Api-py/blob/main/helper/is_site_available.py#L39)

<p>

```json

{
        "1337x": {
            "trending_available": True,
            "trending_category": True,
            "search_by_category": True,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["anime", "music", "games", "tv","apps","documentaries", "other", "xxx", "movies"],
            "limit" : 100
        },
        "torlock": {
            "trending_available": True,
            "trending_category": True,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["anime", "music", "games", "tv","apps", "documentaries", "other", "xxx", "movies", "books", "images"],
            "limit" : 50
        },
        "zooqle": {
            "trending_available": False,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": False,
            "recent_category_available": False,
            "categories": [],
            "limit": 30
        },
        "magnetdl": {
            "trending_available": False,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["apps", "movies", "music", "games", "tv", "books"],
            "limit": 40
        },
        "tgx": {
            "trending_available": True,
            "trending_category": True,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["anime", "music", "games", "tv",
                           "apps", "documentaries", "other", "xxx", "movies", "books"],
            "limit": 50
        },
        "nyaasi": {
            "trending_available": False,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": False,
            "categories": [],
            "limit": 50

        },
        "piratebay": {
            "trending_available": True,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["tv"],
            "limit": 50
        },
        "bitsearch": {
            "trending_available": True,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": False,
            "recent_category_available": False,
            "categories": [],
            "limit": 50
        },
        "kickass": {
            "trending_available": True,
            "trending_category": True,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["anime", "music", "games", "tv","apps", "documentaries", "other", "xxx", "movies", "books"],
            "limit": 50
        },
        "libgen'": {
            "trending_available": False,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": False,
            "recent_category_available": False,
            "categories": [],
            "limit": 25
        },
        "yts": {
            "trending_available": True,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": False,
            "categories": [],
            "limit": 20
        },
        "limetorrent": {
            "trending_available": True,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["anime", "music", "games", "tv",
                           "apps", "other", "movies", "books"],  # applications and tv-shows
            "limit": 50
        },
        "torrentfunk": {
            "trending_available": True,
            "trending_category": True,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["anime", "music", "games", "tv",
                           "apps", "xxx", "movies", "books"],  # television # software #adult # ebooks
            "limit": 50
        },
        "glodls": {
            "trending_available": True,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": False,
            "categories": [],
            "limit": 45
        },
        "torrentproject": {
            "trending_available": False,
            "trending_category": False,
            "search_by_category": False,
            "recent_available": False,
            "recent_category_available": False,
            "categories": [],
            "limit": 20
        },
        "ybt": {
            "trending_available": True,
            "trending_category": True,
            "search_by_category": False,
            "recent_available": True,
            "recent_category_available": True,
            "categories": ["anime", "music", "games", "tv",
                           "apps", "xxx", "movies", "books", "pictures", "other"],  # book -> ebooks
            "limit": 20
        }

    }
```

</p>
</details>

---

## API Endpoints

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Supported sites list</span></summary>
<p>

> `api/v1/sites`

</p>
</details>
<br>

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Site Configs</span></summary>
<p>

> `api/v1/sites/config`

</p>
</details>
<br>

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Search</span></summary>
<p>

> `api/v1/search`

| Parameter | Required |  Type   | Default |                         Example                          |
| :-------: | :------: | :-----: | :-----: | :------------------------------------------------------: |
|   site    |    ✅     | string  |  None   |                `api/v1/search?site=1337x`                |
|   query   |    ✅     | string  |  None   |        `api/v1/search?site=1337x&query=avengers`         |
|   limit   |    ❌     | integer | Default |    `api/v1/search?site=1337x&query=avengers&limit=20`    |
|   page    |    ❌     | integer |    1    | `api/v1/search?site=1337x&query=avengers&limit=0&page=2` |

</p>
</details>
<br>

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Trending</span></summary>
<p>

> `api/v1/trending`

| Parameter | Required |  Type   | Default |                         Example                         |
| :-------: | :------: | :-----: | :-----: | :-----------------------------------------------------: |
|   site    |    ✅     | string  |  None   |              `api/v1/trending?site=1337x`               |
|   limit   |    ❌     | integer | Default |          `api/v1/trending?site=1337x&limit=10`          |
| category  |    ❌     | string  |  None   |    `api/v1/trending?site=1337x&limit=0&category=tv`     |
|   page    |    ❌     | integer |    1    | `api/v1/trending?site=1337x&limit=6&category=tv&page=2` |

</p>
</details>
<br>

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Recent</span></summary>
<p>

> `api/v1/recent`

| Parameter | Required |  Type   | Default |                        Example                         |
| :-------: | :------: | :-----: | :-----: | :----------------------------------------------------: |
|   site    |    ✅     | string  |  None   |               `api/v1/recent?site=1337x`               |
|   limit   |    ❌     | integer | Default |           `api/v1/recent?site=1337x&limit=7`           |
| category  |    ❌     | string  |  None   |     `api/v1/recent?site=1337x&limit=0&category=tv`     |
|   page    |    ❌     | integer |    1    | `api/v1/recent?site=1337x&limit=15&category=tv&page=2` |

</p>
</details>
<br>

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Search By Category</span></summary>
<p>

> `api/v1/category`

| Parameter | Required |  Type   | Default |                                Example                                 |
| :-------: | :------: | :-----: | :-----: | :--------------------------------------------------------------------: |
|   site    |    ✅     | string  |  None   |                      `api/v1/category?site=1337x`                      |
|   query   |    ✅     | string  |  None   |              `api/v1/category?site=1337x&query=avengers`               |
| category  |    ✅     | string  |  None   |      `api/v1/category?site=1337x&query=avengers&category=movies`       |
|   limit   |    ❌     | integer | Default |  `api/v1/category?site=1337x&query=avengers&category=movies&limit=10`  |
|   page    |    ❌     | integer |    1    | `api/v1/category?site=1337x&query=avengers&category=tv&limit=0&page=2` |

</p>
</details>

<br>

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Search from all sites</span></summary>
<p>

> `api/v1/all/search`

| Parameter | Required |  Type   | Default |                  Example                   |
| :-------: | :------: | :-----: | :-----: | :----------------------------------------: |
|   query   |    ✅     | string  |  None   |     `api/v1/all/search?query=avengers`     |
|   limit   |    ❌     | integer | Default | `api/v1/all/search?query=avengers&limit=5` |

<pre>Here <b>limit = 5</b> will get 5 results from each site.</pre>

</pre>
</details>

<br>

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Get trending from all sites</span></summary>
<p>

> `api/v1/all/trending`

| Parameter | Required |  Type   | Default |            Example            |
| :-------: | :------: | :-----: | :-----: | :---------------------------: |
|   limit   |    ❌     | integer | Default | `api/v1/all/trending?limit=2` |

</p>
</details>

<br>

<details open>
<summary style='font-size: 15px'><span style='font-size: 20px;font-weight:bold;'>Get recent from all sites</span></summary>
<p>

> `api/v1/all/recent`

| Parameter | Required |  Type   | Default |           Example           |
| :-------: | :------: | :-----: | :-----: | :-------------------------: |
|   limit   |    ❌     | integer | Default | `api/v1/all/recent?limit=2` |

</p>
</details>

---

## Authentication

To enable authentication, set your API key in the environment variable `PYTORRENTS_API_KEY`. Clients must include this key in the `x-api-key` header of their requests to authenticate successfully.

---

## DEPLOY

<a href="https://render.com/deploy?repo=https://github.com/author/Torrent-Api-py">
<img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" />
</a>

</br>

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)