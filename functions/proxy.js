// /functions/proxy.js - 智能中文图书搜索系统

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

// =======================================================
// 小立盘 (xiaolipan.com) 爬取函数
// =======================================================
async function scrapeXiaolipan(query, isbn, author) {
    const bookLinks = [];
    
    try {
        // 构建更精确的搜索URL - 结合书名和作者
        let searchQuery = query;
        if (author && !query.includes(author)) {
            searchQuery = `${query} ${author}`;
        }
        
        const searchUrl = `https://www.xiaolipan.com/search.html?keyword=${encodeURIComponent(searchQuery)}`;
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
        
        // 解析搜索结果，获取书籍详情页URL和标题
        const bookDetails = parseXiaolipanSearchResults(html, query, author);
        
        if (bookDetails.length === 0) {
            console.log("小立盘未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`小立盘找到 ${bookDetails.length} 个匹配的书籍`);
        
        // 返回书籍详情页链接和对应的下载页链接
        return bookDetails.map(({detailUrl, title}) => {
            // 根据您提供的信息，将/p/替换为/download/得到下载页
            const downloadUrl = detailUrl.replace('/p/', '/download/');
            return {
                site: '小立盘',
                title: title,
                detailUrl: detailUrl,
                downloadUrl: downloadUrl,
                format: '详情页',
                relevance: calculateRelevance(title, query, author)
            };
        }).sort((a, b) => b.relevance - a.relevance); // 按相关性排序
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
        return bookLinks;
    }
}

// 解析小立盘搜索结果
function parseXiaolipanSearchResults(html, query, author) {
    const bookDetails = [];
    
    // 使用更精确的正则表达式查找详情页链接和标题
    // 小立盘的详情页链接格式: /p/数字.html
    const regexPatterns = [
        /<a[^>]*href="(\/p\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>/gi,
        /<h3[^>]*>\s*<a[^>]*href="(\/p\/\d+\.html)"[^>]*>([^<]*)<\/a>\s*<\/h3>/gi
    ];
    
    for (const pattern of regexPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
            if (match && match[1] && match[2]) {
                const detailUrl = `https://www.xiaolipan.com${match[1]}`;
                const title = match[2].trim();
                
                // 检查是否已存在相同的URL
                if (!bookDetails.some(item => item.detailUrl === detailUrl)) {
                    bookDetails.push({detailUrl, title});
                }
            }
        }
    }
    
    return bookDetails;
}

// =======================================================
// Book5678 (book5678.com) 爬取函数
// =======================================================
async function scrapeBook5678(query, isbn, author) {
    const bookLinks = [];
    
    try {
        // 构建更精确的搜索URL - 结合书名和作者
        let searchQuery = query;
        if (author && !query.includes(author)) {
            searchQuery = `${query} ${author}`;
        }
        
        const searchUrl = `https://book5678.com/search.php?q=${encodeURIComponent(searchQuery)}`;
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
        
        // 解析搜索结果，获取书籍详情页URL和标题
        const bookDetails = parseBook5678SearchResults(html, query, author);
        
        if (bookDetails.length === 0) {
            console.log("Book5678未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`Book5678找到 ${bookDetails.length} 个匹配的书籍`);
        
        // 返回书籍详情页链接
        return bookDetails.map(({detailUrl, title}) => ({
            site: 'Book5678',
            title: title,
            detailUrl: detailUrl,
            format: '详情页',
            relevance: calculateRelevance(title, query, author)
        })).sort((a, b) => b.relevance - a.relevance); // 按相关性排序
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return bookLinks;
    }
}

// 解析Book5678搜索结果
function parseBook5678SearchResults(html, query, author) {
    const bookDetails = [];
    
    // 使用正则表达式查找详情页链接和标题
    // Book5678的详情页链接格式: /post/数字.html
    const regexPatterns = [
        /<a[^>]*href="(\/post\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>/gi,
        /<h3[^>]*>\s*<a[^>]*href="(\/post\/\d+\.html)"[^>]*>([^<]*)<\/a>\s*<\/h3>/gi
    ];
    
    for (const pattern of regexPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
            if (match && match[1] && match[2]) {
                const detailUrl = `https://book5678.com${match[1]}`;
                const title = match[2].trim();
                
                // 检查是否已存在相同的URL
                if (!bookDetails.some(item => item.detailUrl === detailUrl)) {
                    bookDetails.push({detailUrl, title});
                }
            }
        }
    }
    
    return bookDetails;
}

// =======================================================
// 35PPT (35ppt.com) 爬取函数
// =======================================================
async function scrape35PPT(query, isbn, author) {
    const bookLinks = [];
    
    try {
        // 构建更精确的搜索URL - 结合书名和作者
        let searchQuery = query;
        if (author && !query.includes(author)) {
            searchQuery = `${query} ${author}`;
        }
        
        const searchUrl = `https://www.35ppt.com/?s=${encodeURIComponent(searchQuery)}`;
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
        
        // 解析搜索结果，获取书籍详情页URL和ID
        const bookDetails = parse35PPTSearchResults(html, query, author);
        
        if (bookDetails.length === 0) {
            console.log("35PPT未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`35PPT找到 ${bookDetails.length} 个匹配的书籍`);
        
        // 返回书籍详情页链接和下载页链接
        return bookDetails.map(({detailUrl, id, title}) => {
            // 根据您提供的信息，构建下载页URL
            const downloadUrl = `https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=${id}`;
            return {
                site: '35PPT',
                title: title,
                detailUrl: detailUrl,
                downloadUrl: downloadUrl,
                format: '详情页',
                relevance: calculateRelevance(title, query, author)
            };
        }).sort((a, b) => b.relevance - a.relevance); // 按相关性排序
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return bookLinks;
    }
}

// 解析35PPT搜索结果
function parse35PPTSearchResults(html, query, author) {
    const bookDetails = [];
    
    // 使用正则表达式查找详情页链接和ID
    // 35PPT的详情页链接格式: /数字.html
    const regexPatterns = [
        /<a[^>]*href="(\/(\d+)\.html)"[^>]*title="([^"]*)"[^>]*>/gi,
        /<h2[^>]*>\s*<a[^>]*href="(\/(\d+)\.html)"[^>]*>([^<]*)<\/a>\s*<\/h2>/gi
    ];
    
    for (const pattern of regexPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
            if (match && match[1] && match[2] && match[3]) {
                const detailUrl = `https://www.35ppt.com${match[1]}`;
                const id = match[2];
                const title = match[3].trim();
                
                // 检查是否已存在相同的URL
                if (!bookDetails.some(item => item.detailUrl === detailUrl)) {
                    bookDetails.push({detailUrl, id, title});
                }
            }
        }
    }
    
    return bookDetails;
}

// =======================================================
// 智能相关性计算函数
// =======================================================

// 计算搜索结果的相关性分数
function calculateRelevance(title, query, author) {
    let score = 0;
    
    // 转换为小写以便比较
    const lowerTitle = title.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const lowerAuthor = author ? author.toLowerCase() : '';
    
    // 1. 检查标题是否完全包含查询词
    if (lowerTitle.includes(lowerQuery)) {
        score += 10;
    }
    
    // 2. 检查标题是否包含查询词的主要部分
    const queryWords = lowerQuery.split(/\s+/);
    let matchedWords = 0;
    
    for (const word of queryWords) {
        if (word.length > 2 && lowerTitle.includes(word)) {
            matchedWords++;
        }
    }
    
    score += matchedWords * 3;
    
    // 3. 检查标题是否包含作者名
    if (lowerAuthor && lowerTitle.includes(lowerAuthor)) {
        score += 5;
    }
    
    // 4. 检查是否是完全匹配
    if (lowerTitle === lowerQuery) {
        score += 20;
    }
    
    // 5. 检查是否是知名书籍的变体
    const knownBooks = {
        "曾国藩传": ["曾国藩传", "曾国藩全传", "曾国藩传记"],
        "曾国藩的正面与侧面": ["曾国藩的正面与侧面", "曾国藩正面与侧面"],
        "晚清七十年": ["晚清七十年", "晚清70年"]
    };
    
    for (const [knownTitle, variants] of Object.entries(knownBooks)) {
        if (variants.some(variant => lowerTitle.includes(variant.toLowerCase()))) {
            score += 15;
            break;
        }
    }
    
    return score;
}

// =======================================================
// 辅助函数
// =======================================================

// 从URL中提取标题
function extractTitleFromUrl(url) {
    // 尝试从URL中提取有意义的标题
    const match = url.match(/\/([^\/]+)\.html?$/);
    if (match && match[1]) {
        // 如果是数字，则返回默认标题
        if (/^\d+$/.test(match[1])) {
            return '书籍详情页';
        }
        return decodeURIComponent(match[1]).replace(/[-_]/g, ' ');
    }
    return '书籍详情页';
}
