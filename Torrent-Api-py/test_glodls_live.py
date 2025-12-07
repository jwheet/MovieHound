import asyncio
from torrents.glodls import Glodls

async def test():
    glodls = Glodls()
    result = await glodls.search("ubuntu", page=1, limit=3)
    print(f"Result: {result}")
    if result and "data" in result:
        print(f"Found {len(result['data'])} results")
        for idx, item in enumerate(result['data'][:2], 1):
            print(f"\nResult {idx}:")
            print(f"  Name: {item.get('name', 'N/A')}")
            print(f"  Size: {item.get('size', 'N/A')}")
            print(f"  Seeders: {item.get('seeders', 'N/A')}")
            print(f"  Leechers: {item.get('leechers', 'N/A')}")
    else:
        print("No results or error")

if __name__ == "__main__":
    asyncio.run(test())
