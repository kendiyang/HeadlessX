import requests
import time

def fetch_amazon_product(asin, page=1):
    """改进版的亚马逊爬取函数"""
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
    }
    
    session = requests.Session()
    session.headers.update(headers)
    
    # 先获取 cookies
    session.get('https://www.amazon.com')
    time.sleep(2)  # 重要：模拟人类行为
    
    # 请求目标页面
    url = f'https://www.amazon.com/dp/{asin}?th={page}'
    response = session.get(url, timeout=15)
    
    return response

# 测试
asin = "B0FFTB9JZ9"
resp = fetch_amazon_product(asin)
print(f"状态码: {resp.status_code}")

if resp.status_code == 200 and 'Robot' not in resp.text:
    print("✅ 成功！")
    with open('amazon_product.html', 'w', encoding='utf-8') as f:
        f.write(resp.text)
else:
    print("❌ 被拦截，需要使用更高级的方法")