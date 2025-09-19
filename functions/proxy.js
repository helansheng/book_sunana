// /functions/proxy.js - 经过测试的可靠版本
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
            return handleBookSiteScraper(scrapeTask.target, scrapeTask.query, scrapeTask.isbn, scrapeTask.author);
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

async function handleBookSiteScraper(target, query, isbn, author) {
    try {
        console.log(`开始爬取 ${target}: ${query}, ISBN: ${isbn}, 作者: ${author}`);
        
        let bookLinks = [];
        
        switch (target) {
            case 'xiaolipan':
                bookLinks = await scrapeXiaolipan(query, isbn, author);
                break;
            case 'book5678':
                bookLinks = await scrapeBook5678(query, isbn, author);
                break;
            case '35ppt':
                bookLinks = await scrape35PPT(query, isbn, author);
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

// 小立盘爬虫 - 经过测试的版本
async function scrapeXiaolipan(query, isbn, author) {
    try {
        const searchUrl = `https://www.xiaolipan.com/search.html?keyword=${encodeURIComponent(query)}`;
        console.log(`小立盘搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        };
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`小立盘搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 使用HTMLRewriter解析HTML
        let currentHref = '';
        
        await new HTMLRewriter()
            .on('a[href*="/p/"]', {
                element(element) {
                    const href = element.getAttribute('href');
                    if (href && href.includes('/p/')) {
                        currentHref = `https://www.xiaolipan.com${href}`;
                    }
                },
                text(text) {
                    if (text.text && text.lastInTextNode) {
                        const title = text.text.trim();
                        if (title && currentHref && !title.includes('小立盘') && title.length > 5) {
                            const relevance = calculateRelevance(title, query, author);
                            if (relevance > 10) {
                                bookDetails.push({
                                    site: '小立盘',
                                    title: title,
                                    detailUrl: currentHref,
                                    downloadUrl: currentHref.replace('/p/', '/download/'),
                                    format: '详情页',
                                    relevance: relevance
                                });
                            }
                        }
                        currentHref = '';
                    }
                }
            })
            .transform(new Response(html))
            .text();
        
        // 去重并按相关性排序
        const uniqueBooks = [];
        const seenUrls = new Set();
        
        for (const book of bookDetails) {
            if (!seenUrls.has(book.detailUrl)) {
                seenUrls.add(book.detailUrl);
                uniqueBooks.push(book);
            }
        }
        
        uniqueBooks.sort((a, b) => b.relevance - a.relevance);
        return uniqueBooks.slice(0, 3);
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
        return [];
    }
}

// Book5678爬虫 - 经过测试的版本
async function scrapeBook5678(query, isbn, author) {
    try {
        const searchUrl = `https://book5678.com/search.php?q=${encodeURIComponent(query)}`;
        console.log(`Book5678搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        };
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`Book5678搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 使用正则表达式查找书籍链接
        const regex = /<a[^>]+href="(\/post\/[^"]+\.html)"[^>]*>([^<]+)<\/a>/g;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            if (match[1] && match[2]) {
                const title = match[2].trim();
                const url = `https://book5678.com${match[1]}`;
                
                if (title && !title.includes('book5678') && title.length > 5) {
                    const relevance = calculateRelevance(title, query, author);
                    if (relevance > 10) {
                        bookDetails.push({
                            site: 'Book5678',
                            title: title,
                            detailUrl: url,
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            }
        }
        
        // 去重并按相关性排序
        const uniqueBooks = [];
        const seenUrls = new Set();
        
        for (const book of bookDetails) {
            if (!seenUrls.has(book.detailUrl)) {
                seenUrls.add(book.detailUrl);
                uniqueBooks.push(book);
            }
        }
        
        uniqueBooks.sort((a, b) => b.relevance - a.relevance);
        return uniqueBooks.slice(0, 3);
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return [];
    }
}

// 35PPT爬虫 - 经过测试的版本
async function scrape35PPT(query, isbn, author) {
    try {
        const searchUrl = `https://www.35ppt.com/?s=${encodeURIComponent(query)}`;
        console.log(`35PPT搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        };
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`35PPT搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 使用正则表达式查找书籍链接
        const regex = /<a[^>]+href="(\/\d+\.html)"[^>]*>([^<]+)<\/a>/g;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            if (match[1] && match[2]) {
                const title = match[2].trim();
                const url = `https://www.35ppt.com${match[1]}`;
                const idMatch = url.match(/\/(\d+)\.html$/);
                
                if (title && idMatch && idMatch[1] && !title.includes('35PPT') && title.length > 5) {
                    const relevance = calculateRelevance(title, query, author);
                    if (relevance > 10) {
                        bookDetails.push({
                            site: '35PPT',
                            title: title,
                            detailUrl: url,
                            downloadUrl: `https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=${idMatch[1]}`,
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            }
        }
        
        // 去重并按相关性排序
        const uniqueBooks = [];
        const seenUrls = new Set();
        
        for (const book of bookDetails) {
            if (!seenUrls.has(book.detailUrl)) {
                seenUrls.add(book.detailUrl);
                uniqueBooks.push(book);
            }
        }
        
        uniqueBooks.sort((a, b) => b.relevance - a.relevance);
        return uniqueBooks.slice(0, 3);
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return [];
    }
}

// 智能相关性计算函数
function calculateRelevance(title, query, author) {
    let score = 0;
    
    const lowerTitle = title.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const lowerAuthor = author ? author.toLowerCase() : '';
    
    // 检查标题是否包含查询词
    if (lowerTitle.includes(lowerQuery)) {
        score += 50;
    }
    
    // 检查标题是否包含查询词的主要部分
    const queryWords = lowerQuery.split(/\s+/);
    for (const word of queryWords) {
        if (word.length > 1 && lowerTitle.includes(word)) {
            score += 10;
        }
    }
    
    // 检查标题是否包含作者名
    if (lowerAuthor && lowerTitle.includes(lowerAuthor)) {
        score += 30;
    }
    
    // 检查是否是完全匹配
    if (lowerTitle === lowerQuery) {
        score += 100;
    }
    
    // 检查标题长度 - 过短的标题可能是导航元素
    if (title.length < 5) {
        score -= 50;
    }
    
    // 检查是否包含网站名称 - 排除导航元素
    if (lowerTitle.includes("小立盘") || lowerTitle.includes("book5678") || lowerTitle.includes("35ppt")) {
        score -= 100;
    }
    
    return Math.max(0, score);
}
