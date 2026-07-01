import requests
from curl_adapter import CurlCffiAdapter
from bs4 import BeautifulSoup
import re
import json
import time
import urllib.parse

class GameIndexScraper:
    def __init__(self):
        self.base_url = "https://nxbrew.net"
        # Use curl-adapter to mimic a real browser TLS fingerprint
        self.session = requests.Session()
        self.session.mount("http://", CurlCffiAdapter())
        self.session.mount("https://", CurlCffiAdapter())
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://nxbrew.net/',
            'DNT': '1'
        })
        self.downloads = []

    def get_page(self, url):
        try:
            r = self.session.get(url, timeout=45)
            print(f"    DEBUG: Status {r.status_code} for {url}")
            if r.status_code != 200:
                return None
            if 'cf-browser-verification' in r.text or 'Checking your browser' in r.text:
                print("    DEBUG: Cloudflare challenge detected – skipping.")
                return None
            return r.text
        except Exception as e:
            print(f"    Error fetching {url}: {e}")
            return None

    # ---------- OUO BYPASS USING curl-adapter ----------
    def resolve_ouo(self, url):
        """Bypass ouo.io / ouo.press using curl-adapter session."""
        print(f"    Bypassing ouo: {url}")
        try:
            resp = self.session.get(url, timeout=30)
            if resp.status_code != 200:
                print(f"      Status {resp.status_code} - keeping original")
                return url

            html = resp.text
            soup = BeautifulSoup(html, 'lxml')

            # 1. Meta refresh
            meta = soup.find('meta', attrs={'http-equiv': 'refresh'})
            if meta and meta.get('content'):
                content = meta['content']
                match = re.search(r'url=(.*?)(?:\s|$)', content, re.I)
                if match:
                    inner = match.group(1)
                    if inner.startswith('/'):
                        inner = urllib.parse.urljoin(url, inner)
                    if inner != url:
                        print(f"      Resolved (meta) to: {inner}")
                        return inner

            # 2. Common link elements
            link = soup.find('a', {'id': 'btn-main'}) or \
                   soup.find('a', {'id': 'link'}) or \
                   soup.find('a', {'class': 'btn'}) or \
                   soup.find('a', {'class': 'download'})
            if link:
                target = link.get('data-href') or link.get('href')
                if target:
                    if target.startswith('/'):
                        target = urllib.parse.urljoin(url, target)
                    if target and target != url and 'ouo' not in target:
                        print(f"      Resolved (link) to: {target}")
                        return target

            # 3. onclick events
            for element in soup.find_all(attrs={"onclick": True}):
                onclick = element['onclick']
                match = re.search(r"window\.location\s*=\s*['\"]([^'\"]+)['\"]", onclick)
                if match:
                    inner = match.group(1)
                    if inner.startswith('/'):
                        inner = urllib.parse.urljoin(url, inner)
                    if inner and inner != url and 'ouo' not in inner:
                        print(f"      Resolved (onclick) to: {inner}")
                        return inner

            # 4. JavaScript variables and assignments
            scripts = soup.find_all('script')
            for script in scripts:
                if script.string:
                    content = script.string
                    match = re.search(r'var\s+url\s*=\s*["\'](https?://[^"\']+)["\']', content)
                    if match:
                        inner = match.group(1)
                        if inner and inner != url and 'ouo' not in inner:
                            print(f"      Resolved (js var) to: {inner}")
                            return inner
                    match = re.search(r'window\.location\s*=\s*["\'](https?://[^"\']+)["\']', content)
                    if match:
                        inner = match.group(1)
                        if inner and inner != url and 'ouo' not in inner:
                            print(f"      Resolved (js location) to: {inner}")
                            return inner
                    match = re.search(r'setTimeout\s*\(\s*function\s*\(\s*\)\s*\{\s*window\.location\s*=\s*["\'](https?://[^"\']+)["\']', content)
                    if match:
                        inner = match.group(1)
                        if inner and inner != url and 'ouo' not in inner:
                            print(f"      Resolved (setTimeout) to: {inner}")
                            return inner

            # 5. Final fallback: scan entire page for known download hosts
            download_hosts = ['1fichier', 'multiup', 'datanodes', 'mediafire', 'mega.nz', 'pixeldrain']
            for host in download_hosts:
                pattern = rf'https?://[^"\'\s]*{re.escape(host)}[^"\'\s]*'
                match = re.search(pattern, html, re.I)
                if match:
                    final = match.group(0)
                    print(f"      Resolved (host regex) to: {final}")
                    return final

            print("      No resolution found, keeping original")
            return url

        except Exception as e:
            print(f"      Bypass error: {e} - keeping original")
            return url

    def resolve_url(self, url):
        if not url:
            return None
        if 'ouo.io' in url or 'ouo.press' in url:
            return self.resolve_ouo(url)

        # Other shorteners: follow redirects and meta-refresh
        shortener_domains = [
            'linkvertise', 'adf.ly', 'shorte.st', 'bc.vc', 'tinyurl',
            'bit.ly', 'goo.gl', 'lc.ch', 'rebrand.ly', 'shorturl.at', 'rb.gy',
            'cutt.ly', 'ow.ly', 'is.gd', 'buff.ly', 't.co', 'dlj.bz', 'anonym.to',
            'url4short.com', 'sh.st', 'v.gd', 'tiny.cc', 'clck.ru', 'migre.me',
            'j.mp', 'bitly.com', 'short.link', 'shorl.com', 'zx.al', 'x.co',
            'po.st', 'q.gs', 'cur.lv', 'tny.cz', 'soo.gd'
        ]

        try:
            resp = self.session.get(url, allow_redirects=True, timeout=30)
            final_url = resp.url
            parsed = urllib.parse.urlparse(final_url)
            if any(dom in parsed.netloc.lower() for dom in shortener_domains):
                soup = BeautifulSoup(resp.text, 'html.parser')
                meta = soup.find('meta', attrs={'http-equiv': 'refresh'})
                if meta and meta.get('content'):
                    content = meta['content']
                    match = re.search(r'url=(.*?)(?:\s|$)', content, re.I)
                    if match:
                        inner = match.group(1)
                        if inner.startswith('/'):
                            inner = urllib.parse.urljoin(final_url, inner)
                        if inner != url:
                            return self.resolve_url(inner)
                for a in soup.find_all('a', href=True):
                    text = a.get_text(strip=True).lower()
                    if 'download' in text or 'continue' in text or 'click here' in text:
                        href = a['href']
                        if href.startswith('http'):
                            return href
                        elif href.startswith('/'):
                            return urllib.parse.urljoin(final_url, href)
                return final_url
            else:
                return final_url
        except Exception as e:
            print(f"      Resolve error for {url}: {e}")
            return url

    def extract_download_links(self, soup):
        raw_links = []
        hosters = [
            '1fichier', 'multiup', 'datanodes', 'mediafire', 'mega.nz',
            'pixeldrain', 'gofile', 'dropbox', 'onedrive', 'send.cm',
            'uploadrar', 'uploadgig', 'rapidgator', 'turbobit', 'hitfile'
        ]
        shorteners = [
            'linkvertise', 'adf.ly', 'ouo.io', 'ouo.press', 'shorte.st', 'bc.vc', 'tinyurl',
            'bit.ly', 'goo.gl', 'lc.ch', 'rebrand.ly', 'shorturl.at', 'rb.gy',
            'cutt.ly', 'ow.ly', 'is.gd', 'buff.ly', 't.co', 'dlj.bz', 'anonym.to'
        ]

        for a in soup.find_all('a', href=True):
            href = a['href'].strip()
            text = a.get_text(strip=True).lower()

            if not href or href.startswith('#') or href.startswith('javascript:') or href.startswith('mailto:'):
                continue

            if any(host in href for host in hosters):
                raw_links.append(href)
                continue

            parsed = urllib.parse.urlparse(href)
            if any(dom in parsed.netloc.lower() for dom in shorteners):
                raw_links.append(href)
                continue

            if any(kw in text for kw in ['download', '1fichier', 'multiup', 'datanodes', 'mediafire', 'mega', 'pixeldrain']):
                raw_links.append(href)
                continue

            classes = a.get('class', [])
            if any('download' in cls or 'btn' in cls or 'file' in cls for cls in classes):
                raw_links.append(href)

        # Filter out social/internal junk
        filtered = []
        seen = set()
        for link in raw_links:
            if any(bad in link for bad in [
                'x.com', 'twitter.com', 'facebook.com', 'reddit.com',
                'how-to-extract-merge-multiple-files',
                'wp-login', 'wp-admin', '#comment', '?page'
            ]):
                continue
            if link not in seen and not link.endswith('/') and not link == self.base_url:
                seen.add(link)
                filtered.append(link)

        return filtered

    def resolve_all_links(self, links):
        resolved = []
        for idx, link in enumerate(links, 1):
            print(f"    Resolving [{idx}/{len(links)}]: {link}")
            if any(host in link for host in ['1fichier', 'multiup', 'datanodes', 'mediafire', 'mega.nz', 'pixeldrain']):
                final = link
            else:
                final = self.resolve_url(link)
            if final and final not in resolved:
                resolved.append(final)
            time.sleep(1)  # polite delay

        print(f"    Final resolved links ({len(resolved)}):")
        for r in resolved:
            print(f"      -> {r}")

        return resolved

    def extract_title(self, soup):
        title = soup.find('h1', class_='entry-title')
        if not title:
            title = soup.find('h1', class_='post-title')
        if not title:
            title = soup.find('title')
        if title:
            txt = title.text.strip()
            txt = re.sub(r'\s*[–\-|]\s*nxbrew(\.net)?', '', txt, flags=re.I)
            return txt
        return "Unknown Title"

    def extract_size(self, html):
        m = re.search(r'(\d+(?:\.\d+)?)\s*(GB|MB|TB)', html, re.IGNORECASE)
        if m:
            return f"{m.group(1)} {m.group(2)}"
        m2 = re.search(r'Size\s*[:;]\s*(\d+(?:\.\d+)?)\s*(GB|MB|TB)', html, re.IGNORECASE)
        if m2:
            return f"{m2.group(1)} {m2.group(2)}"
        return "Unknown"

    def extract_date(self, soup):
        meta = soup.find('meta', property='article:published_time')
        if meta and meta.get('content'):
            return meta['content'][:10]
        meta2 = soup.find('meta', {'name': 'published-date'})
        if meta2 and meta2.get('content'):
            return meta2['content'][:10]
        m = re.search(r'(\d{4}-\d{2}-\d{2})', str(soup))
        if m:
            return m.group(1)
        m2 = re.search(r'(\d{2}/\d{2}/\d{4})', str(soup))
        if m2:
            return m2.group(1)
        return time.strftime('%Y-%m-%d')

    def parse_post(self, url):
        print(f"  Parsing: {url}")
        html = self.get_page(url)
        if not html:
            return None
        soup = BeautifulSoup(html, 'html.parser')
        raw_links = self.extract_download_links(soup)
        if not raw_links:
            print("    No download links found.")
            return None
        print(f"    Found {len(raw_links)} raw links.")
        final_links = self.resolve_all_links(raw_links)
        if not final_links:
            print("    All links failed to resolve.")
            return None
        title = self.extract_title(soup)
        size = self.extract_size(html)
        date = self.extract_date(soup)
        return {
            'title': title,
            'downloadLinks': final_links,
            'fileSize': size,
            'uploadDate': date,
            'sourceUrl': url
        }

    def scrape_posts_from_page(self, page_url):
        html = self.get_page(page_url)
        if not html:
            return []

        soup = BeautifulSoup(html, 'html.parser')
        post_links = set()

        for a in soup.find_all('a', href=True):
            href = a['href']
            if href.startswith('/'):
                href = self.base_url + href
            if self.base_url in href:
                if any(x in href for x in ['category', 'tag', 'author', 'page/', 'wp-', '#']):
                    continue
                if '/switch/' in href or '/games/' in href or '/download/' in href:
                    post_links.add(href)
                else:
                    path = href.replace(self.base_url, '')
                    if path.count('/') == 2 and path.endswith('/') and len(path) > 3:
                        post_links.add(href)

        containers = soup.find_all(['article', 'div'], class_=re.compile(r'(post|entry|game|item)'))
        for container in containers:
            for a in container.find_all('a', href=True):
                href = a['href']
                if href.startswith('/'):
                    href = self.base_url + href
                if self.base_url in href and not any(x in href for x in ['category', 'tag', 'author', 'page/', 'wp-']):
                    post_links.add(href)

        return list(post_links)

    def scrape(self, max_pages=5, delay=2.0):
        for page_num in range(1, max_pages + 1):
            url = self.base_url if page_num == 1 else f"{self.base_url}/page/{page_num}/"
            print(f"\n📄 Scraping page {page_num}: {url}")
            post_urls = self.scrape_posts_from_page(url)
            if not post_urls:
                print("  No post links found – stopping.")
                break
            print(f"  Found {len(post_urls)} post links.")
            for i, post_url in enumerate(post_urls[:25], 1):
                print(f"\n  [{i}/{min(len(post_urls), 25)}]")
                data = self.parse_post(post_url)
                if data:
                    self.downloads.append(data)
                    print(f"    ✅ Added: {data['title']} ({len(data['downloadLinks'])} links)")
                else:
                    print("    ❌ Skipped (no data)")
                time.sleep(delay)
        return self.downloads

    def save(self, filename='game_index.json'):
        output = {
            "name": "GameIndex",
            "scrapedAt": time.strftime('%Y-%m-%d %H:%M:%S'),
            "downloads": self.downloads
        }
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f"\n💾 Saved {len(self.downloads)} entries to {filename}")

if __name__ == "__main__":
    scraper = GameIndexScraper()
    scraper.scrape(max_pages=3, delay=2.0)
    scraper.save()