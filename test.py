import requests
import time
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Optional

# 模拟一个更真实的浏览器请求头
BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
}

def fetch_product_page(page_index: int, asin: str = "B0FFTB9JZ9", ref: str = "lp_87586176011_1_1") -> Optional[Dict]:
    """
    获取单页数据（带重试和延迟）
    实际URL: https://www.amazon.com/dp/{ASIN}/ref={REF}.json?th={PAGE_INDEX}
    """
    # 构建目标URL
    #url = f"https://www.amazon.com/dp/{asin}/ref={ref}.json?th={page_index}"
    #url = f"https://www.amazon.com/dp/{asin}?th={page_index}"
    url = f"https://www.ebay.com/itm/388886907012"
    #url = f'https://www.amazon.com/-/zh/product-reviews/{asin}/ref=cm_cr_arp_d_viewopt_srt?filterByStar=critical&reviewerType=all_reviews&pageNumber={page_index}&sortBy=recent#reviews-filter-bar'
    
    # 每次请求使用不同的请求头，模仿浏览器差异
    headers = BASE_HEADERS.copy()
    headers['User-Agent'] = BASE_HEADERS['User-Agent'][:-13] + str(random.randint(100, 199))  # 微小变化
    
    # 随机延迟，避免请求过于规律 (0.5~2.5秒)
    delay = random.uniform(0.1,0.5)
    time.sleep(delay)
    
    try:
        print(f"⏳ 正在获取第 {page_index} 页 (th={page_index}) 延迟 {delay:.2f}s...")
        # 关键：添加 timeout，避免卡死
        response = requests.get(url, headers=headers, timeout=15)
        
        if response.status_code == 200:
            print(f"✅ 第 {page_index} 页成功获取")
            # 根据实际返回内容解析，假设返回JSON或HTML
            # 如果是JSON接口，使用 response.json()
            # 这里是示例，实际可能是HTML，需用BeautifulSoup解析
            return {
                'page': page_index,
                'status_code': response.status_code,
                'content': response.text,  # 或 response.json()
                'url': response.url
            }
        else:
            print(f"❌ 第 {page_index} 页失败，状态码: {response.status_code}")
            return None
            
    except requests.exceptions.RequestException as e:
        print(f"⚠️ 第 {page_index} 页请求异常: {e}")
        return None

def concurrent_fetch(total_pages: int = 100, max_workers: int = 3):
    """
    并发控制主函数
    :param total_pages: 总页数 (th 的最大值)
    :param max_workers: 并发线程数 (建议 3~5)
    """
    results = []
    # 使用线程池
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # 提交所有任务 (页面索引 1 到 total_pages)
        future_to_page = {
            executor.submit(fetch_product_page, page): page 
            for page in range(1, total_pages + 1)
        }
        
        # 获取完成的结果
        for future in as_completed(future_to_page):
            page = future_to_page[future]
            try:
                result = future.result()
                if result:
                    results.append(result)
            except Exception as exc:
                print(f'第 {page} 页产生异常: {exc}')
    
    # 按页码排序
    results.sort(key=lambda x: x['page'])
    print(f"\n🎉 完成。成功获取 {len(results)} / {total_pages} 页")
    return results

if __name__ == "__main__":
    # 示例：获取前 10 页（实际使用时请调整为100）
    # 建议先测试 3-5 页，确认能正常工作后再扩大范围
    data = concurrent_fetch(total_pages=1, max_workers=1)
    
    # 可以在这里将 data 保存到文件或进一步处理
    # 例如保存第一页的前500字符预览
    if data:
        print("\n📄 第1页内容预览:")
        print(data[0]['content'])
