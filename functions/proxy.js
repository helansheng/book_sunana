// /functions/proxy.js - 移除ManyBooks，新增三个中文图书网站支持

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
        
        let downloadLinks = [];
        
        switch (target) {
            case 'xiaolipan':
                downloadLinks = await scrapeXiaolipan(query, isbn);
                break;
            case 'book5678':
                downloadLinks = await scrapeBook5678(query, isbn);
                break;
            case '35ppt':
                downloadLinks = await scrape35PPT(query, isbn);
                break;
            default:
                throw new Error(`未知的目标网站: ${target}`);
        }
        
        console.log(`从 ${target} 获取到 ${downloadLinks.length} 个下载链接`);
        
        return new Response(JSON.stringify(downloadLinks), {
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
    const downloadLinks = [];
    
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
        const bookDetailUrl = parseXiaolipanSearchResults(html, query);
        
        if (!bookDetailUrl) {
            console.log("小立盘未找到匹配的书籍");
            return downloadLinks;
        }
        
        console.log(`小立盘找到书籍详情页: ${bookDetailUrl}`);
        
        // 访问详情页获取下载链接
        const detailResponse = await fetch(bookDetailUrl, { headers });
        
        if (!detailResponse.ok) {
            throw new Error(`小立盘详情页请求失败: ${detailResponse.status}`);
        }
        
        const detailHtml = await detailResponse.text();
        
        // 解析下载链接
        return parseXiaolipanDownloadLinks(detailHtml);
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
        return downloadLinks;
    }
}

// 解析小立盘搜索结果
function parseXiaolipanSearchResults(html, query) {
    // 使用正则表达式查找详情页链接
    // 小立盘的搜索结果页通常包含类似这样的链接: <a href="/book/12345">书名</a>
    const regexPatterns = [
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*title="[^"]*"[^>]*>/i,
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*class="[^"]*title[^"]*"[^>]*>/i,
        /<h3[^>]*>\s*<a[^>]*href="(\/book\/[^"]*)"[^>]*>/i
    ];
    
    for (const pattern of regexPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            return `https://www.xiaolipan.com${match[1]}`;
        }
    }
    
    return null;
}

// 解析小立盘下载链接
function parseXiaolipanDownloadLinks(html) {
    const downloadLinks = [];
    
    // 使用正则表达式查找下载链接
    // 小立盘的下载链接通常包含"下载"或"download"字样
    const downloadRegex = /<a[^>]*href="([^"]*)"[^>]*>(下载|Download)[^<]*<\/a>/gi;
    let downloadMatch;
    
    while ((downloadMatch = downloadRegex.exec(html)) !== null) {
        const url = downloadMatch[1];
        if (url && !url.startsWith('javascript:')) {
            downloadLinks.push({
                format: getFormatFromUrl(url),
                url: url.startsWith('http') ? url : `https://www.xiaolipan.com${url}`
            });
        }
    }
    
    return downloadLinks;
}

// =======================================================
// Book5678 (book5678.com) 爬取函数
// =======================================================
async function scrapeBook5678(query, isbn) {
    const downloadLinks = [];
    
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
        const bookDetailUrl = parseBook5678SearchResults(html, query);
        
        if (!bookDetailUrl) {
            console.log("Book5678未找到匹配的书籍");
            return downloadLinks;
        }
        
        console.log(`Book5678找到书籍详情页: ${bookDetailUrl}`);
        
        // 访问详情页获取下载链接
        const detailResponse = await fetch(bookDetailUrl, { headers });
        
        if (!detailResponse.ok) {
            throw new Error(`Book5678详情页请求失败: ${detailResponse.status}`);
        }
        
        const detailHtml = await detailResponse.text();
        
        // 解析下载链接
        return parseBook5678DownloadLinks(detailHtml);
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return downloadLinks;
    }
}

// 解析Book5678搜索结果
function parseBook5678SearchResults(html, query) {
    // 使用正则表达式查找详情页链接
    const regexPatterns = [
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*title="[^"]*"[^>]*>/i,
        /<a[^>]*href="(\/detail\/[^"]*)"[^>]*class="[^"]*title[^"]*"[^>]*>/i,
        /<h3[^>]*>\s*<a[^>]*href="(\/book\/[^"]*)"[^>]*>/i
    ];
    
    for (const pattern of regexPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            return `https://book5678.com${match[1]}`;
        }
    }
    
    return null;
}

// 解析Book5678下载链接
function parseBook5678DownloadLinks(html) {
    const downloadLinks = [];
    
    // 使用正则表达式查找下载链接
    const downloadRegex = /<a[^>]*href="([^"]*)"[^>]*>(下载|百度网盘|蓝奏云|天翼云)[^<]*<\/a>/gi;
    let downloadMatch;
    
    while ((downloadMatch = downloadRegex.exec(html)) !== null) {
        const url = downloadMatch[1];
        if (url && !url.startsWith('javascript:')) {
            downloadLinks.push({
                format: getFormatFromUrl(url),
                url: url.startsWith('http') ? url : `https://book5678.com${url}`
            });
        }
    }
    
    return downloadLinks;
}

// =======================================================
// 35PPT (35ppt.com) 爬取函数
// =======================================================
async function scrape35PPT(query, isbn) {
    const downloadLinks = [];
    
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
        const bookDetailUrl = parse35PPTSearchResults(html, query);
        
        if (!bookDetailUrl) {
            console.log("35PPT未找到匹配的书籍");
            return downloadLinks;
        }
        
        console.log(`35PPT找到书籍详情页: ${bookDetailUrl}`);
        
        // 访问详情页获取下载链接
        const detailResponse = await fetch(bookDetailUrl, { headers });
        
        if (!detailResponse.ok) {
            throw new Error(`35PPT详情页请求失败: ${detailResponse.status}`);
        }
        
        const detailHtml = await detailResponse.text();
        
        // 解析下载链接
        return parse35PPTDownloadLinks(detailHtml);
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return downloadLinks;
    }
}

// 解析35PPT搜索结果
function parse35PPTSearchResults(html, query) {
    // 使用正则表达式查找详情页链接
    const regexPatterns = [
        /<a[^>]*href="(\/ppt\/[^"]*)"[^>]*title="[^"]*"[^>]*>/i,
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*class="[^"]*title[^"]*"[^>]*>/i,
        /<h3[^>]*>\s*<a[^>]*href="(\/down\/[^"]*)"[^>]*>/i
    ];
    
    for (const pattern of regexPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            return `https://www.35ppt.com${match[1]}`;
        }
    }
    
    return null;
}

// 解析35PPT下载链接
function parse35PPTDownloadLinks(html) {
    const downloadLinks = [];
    
    // 使用正则表达式查找下载链接
    const downloadRegex = /<a[^>]*href="([^"]*)"[^>]*>(下载|百度网盘|蓝奏云|天翼云|城通网盘)[^<]*<\/a>/gi;
    let downloadMatch;
    
    while ((downloadMatch = downloadRegex.exec(html)) !== null) {
        const url = downloadMatch[1];
        if (url && !url.startsWith('javascript:')) {
            downloadLinks.push({
                format: getFormatFromUrl(url),
                url: url.startsWith('http') ? url : `https://www.35ppt.com${url}`
            });
        }
    }
    
    return downloadLinks;
}

// =======================================================
// 辅助函数
// =======================================================

// 从URL中提取文件格式
function getFormatFromUrl(url) {
    if (url.includes('baidu')) return '百度网盘';
    if (url.includes('lanzou')) return '蓝奏云';
    if (url.includes('ctfile')) return '城通网盘';
    if (url.includes('189')) return '天翼云';
    
    // 从文件扩展名判断格式
    if (url.includes('.pdf')) return 'PDF';
    if (url.includes('.epub')) return 'EPUB';
    if (url.includes('.mobi')) return 'MOBI';
    if (url.includes('.azw3')) return 'AZW3';
    if (url.includes('.txt')) return 'TXT';
    
    return '下载';
}

// 检查字符串是否包含中文字符
function hasChineseCharacters(str) {
    return /[\u4e00-\u9fff]/.test(str);
}
