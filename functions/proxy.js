// /functions/proxy.js - 修改中文图书网站爬虫逻辑

// =======================================================
// 主路由函数
// =======================================================
export async function onRequest(context) {
    const { request } = context;

    if (request.method !== 'POST') {
        return new Response('Invalid request method. Only POST is accepted.', { status: 405 });
    }

    try {
        const requestData = await request.json();
        const { apiKey, body, scrapeTask } = requestData;

        // 处理图书网站爬取任务
        if (scrapeTask && scrapeTask.target) {
            return handleBookSiteScraper(scrapeTask.target, scrapeTask.query, scrapeTask.isbn);
        }

        // 处理 Gemini API 请求
        if (!apiKey || !body) {
            return new Response(JSON.stringify({ error: 'Missing apiKey or body for Gemini API call' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return handleGeminiApiProxy(apiKey, body);

    } catch (error) {
        console.error('Proxy Error:', error);
        return new Response(JSON.stringify({ error: 'Proxy server error', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// =======================================================
// 处理 Gemini API 的函数
// =======================================================
async function handleGeminiApiProxy(apiKey, body) {
    const modelName = 'gemini-2.5-pro';
    const googleApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const googleResponse = await fetch(googleApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    
    return new Response(googleResponse.body, {
        status: googleResponse.status,
        headers: googleResponse.headers,
    });
}

// =======================================================
// 处理图书网站爬取的函数
// =======================================================
async function handleBookSiteScraper(target, query, isbn) {
    try {
        console.log(`开始爬取 ${target}: ${query}, ISBN: ${isbn}`);
        
        let bookLinks = [];
        
        switch (target) {
            case 'xiaolipan':
                bookLinks = await scrapeXiaolipan(query, isbn);
                break;
            case 'book5678':
                bookLinks = await scrapeBook5678(query, isbn);
                break;
            case '35ppt':
                bookLinks = await scrape35PPT(query, isbn);
                break;
            default:
                throw new Error(`未知的目标网站: ${target}`);
        }
        
        console.log(`从 ${target} 获取到 ${bookLinks.length} 个书籍链接`);
        
        return new Response(JSON.stringify(bookLinks), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error(`${target} Scraper Error:`, error);
        return new Response(JSON.stringify({ 
            error: `Failed to scrape ${target}`, 
            details: error.message 
        }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
}

// =======================================================
// 小立盘 (xiaolipan.com) 爬取函数
// =======================================================
async function scrapeXiaolipan(query, isbn) {
    const bookLinks = [];
    
    try {
        // 构建搜索URL
        const searchUrl = `https://www.xiaolipan.com/search?keyword=${encodeURIComponent(query)}`;
        console.log(`小立盘搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': 'https://www.xiaolipan.com/',
        };
        
        // 执行搜索
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`小立盘搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 解析搜索结果，获取书籍详情页URL
        const bookDetailUrls = parseXiaolipanSearchResults(html, query);
        
        if (bookDetailUrls.length === 0) {
            console.log("小立盘未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`小立盘找到 ${bookDetailUrls.length} 个匹配的书籍`);
        
        // 返回书籍详情页链接
        return bookDetailUrls.map(url => ({
            site: '小立盘',
            title: extractTitleFromUrl(url),
            url: url,
            format: '详情页'
        }));
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
        return bookLinks;
    }
}

// 解析小立盘搜索结果
function parseXiaolipanSearchResults(html, query) {
    const bookUrls = [];
    
    // 使用正则表达式查找详情页链接
    // 小立盘的搜索结果页通常包含类似这样的链接: <a href="/book/12345">书名</a>
    const regexPatterns = [
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*title="[^"]*"[^>]*>/gi,
        /<a[^>]*href="(\/p\/[^"]*)"[^>]*title="[^"]*"[^>]*>/gi,
        /<a[^>]*href="(\/download\/[^"]*)"[^>]*title="[^"]*"[^>]*>/gi,
        /<h3[^>]*>\s*<a[^>]*href="(\/book\/[^"]*)"[^>]*>/gi
    ];
    
    for (const pattern of regexPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
            if (match && match[1]) {
                const url = `https://www.xiaolipan.com${match[1]}`;
                if (!bookUrls.includes(url)) {
                    bookUrls.push(url);
                }
            }
        }
    }
    
    return bookUrls.slice(0, 3); // 返回最多3个结果
}

// =======================================================
// Book5678 (book5678.com) 爬取函数
// =======================================================
async function scrapeBook5678(query, isbn) {
    const bookLinks = [];
    
    try {
        // 构建搜索URL
        const searchUrl = `https://book5678.com/search?q=${encodeURIComponent(query)}`;
        console.log(`Book5678搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': 'https://book5678.com/',
        };
        
        // 执行搜索
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`Book5678搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 解析搜索结果，获取书籍详情页URL
        const bookDetailUrls = parseBook5678SearchResults(html, query);
        
        if (bookDetailUrls.length === 0) {
            console.log("Book5678未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`Book5678找到 ${bookDetailUrls.length} 个匹配的书籍`);
        
        // 返回书籍详情页链接
        return bookDetailUrls.map(url => ({
            site: 'Book5678',
            title: extractTitleFromUrl(url),
            url: url,
            format: '详情页'
        }));
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return bookLinks;
    }
}

// 解析Book5678搜索结果
function parseBook5678SearchResults(html, query) {
    const bookUrls = [];
    
    // 使用正则表达式查找详情页链接
    const regexPatterns = [
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*title="[^"]*"[^>]*>/gi,
        /<a[^>]*href="(\/detail\/[^"]*)"[^>]*class="[^"]*title[^"]*"[^>]*>/gi,
        /<h3[^>]*>\s*<a[^>]*href="(\/book\/[^"]*)"[^>]*>/gi
    ];
    
    for (const pattern of regexPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
            if (match && match[1]) {
                const url = `https://book5678.com${match[1]}`;
                if (!bookUrls.includes(url)) {
                    bookUrls.push(url);
                }
            }
        }
    }
    
    return bookUrls.slice(0, 3); // 返回最多3个结果
}

// =======================================================
// 35PPT (35ppt.com) 爬取函数
// =======================================================
async function scrape35PPT(query, isbn) {
    const bookLinks = [];
    
    try {
        // 构建搜索URL
        const searchUrl = `https://www.35ppt.com/search/${encodeURIComponent(query)}`;
        console.log(`35PPT搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': 'https://www.35ppt.com/',
        };
        
        // 执行搜索
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`35PPT搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 解析搜索结果，获取书籍详情页URL
        const bookDetailUrls = parse35PPTSearchResults(html, query);
        
        if (bookDetailUrls.length === 0) {
            console.log("35PPT未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`35PPT找到 ${bookDetailUrls.length} 个匹配的书籍`);
        
        // 返回书籍详情页链接
        return bookDetailUrls.map(url => ({
            site: '35PPT',
            title: extractTitleFromUrl(url),
            url: url,
            format: '详情页'
        }));
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return bookLinks;
    }
}

// 解析35PPT搜索结果
function parse35PPTSearchResults(html, query) {
    const bookUrls = [];
    
    // 使用正则表达式查找详情页链接
    const regexPatterns = [
        /<a[^>]*href="(\/ppt\/[^"]*)"[^>]*title="[^"]*"[^>]*>/gi,
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*class="[^"]*title[^"]*"[^>]*>/gi,
        /<h3[^>]*>\s*<a[^>]*href="(\/down\/[^"]*)"[^>]*>/gi
    ];
    
    for (const pattern of regexPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
            if (match && match[1]) {
                const url = `https://www.35ppt.com${match[1]}`;
                if (!bookUrls.includes(url)) {
                    bookUrls.push(url);
                }
            }
        }
    }
    
    return bookUrls.slice(0, 3); // 返回最多3个结果
}

// =======================================================
// 辅助函数
// =======================================================

// 从URL中提取标题
function extractTitleFromUrl(url) {
    // 尝试从URL中提取有意义的标题
    const match = url.match(/\/([^\/]+)\.html?$/);
    if (match && match[1]) {
        return decodeURIComponent(match[1]).replace(/[-_]/g, ' ');
    }
    return '书籍详情页';
}
