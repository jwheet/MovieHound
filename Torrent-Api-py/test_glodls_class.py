import asyncio
import sys
from torrents.glodls import Glodls

async def test():
    print("Creating Glodls instance...")
    glodls = Glodls()

    print(f"BASE_URL: {glodls.BASE_URL}")
    print("Calling search...")

    try:
        result = await glodls.search("ubuntu", page=1, limit=3)
        print(f"\nResult type: {type(result)}")
        print(f"Result: {result}")

        if result:
            if "data" in result:
                print(f"\n✓ Found {len(result['data'])} results")
                for idx, item in enumerate(result['data'][:2], 1):
                    print(f"\nResult {idx}:")
                    print(f"  Name: {item.get('name', 'N/A')}")
                    print(f"  Size: {item.get('size', 'N/A')}")
                    print(f"  Seeders: {item.get('seeders', 'N/A')}")
            else:
                print(f"✗ No 'data' key in result: {result.keys()}")
        else:
            print("✗ Result is None or empty")

    except Exception as e:
        print(f"✗ Exception: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
